// xBot's native screen recorder (see docs/ARCHITECTURE.md → "Recording").
//
// ScreenCaptureKit records a display, a window or an area of a display with
// the cursor hidden and xBot's own windows left out, plus system audio
// (macOS 13+) and a microphone (macOS 15+), into one MP4 with AVAssetWriter.
// Pausing drops samples and shifts the later ones back, so the file has no
// gap. Separately, an AppKit event monitor records where the cursor is, its
// clicks and the cursor image in use, so the editor can draw the cursor
// itself. Every time is host time (CACurrentMediaTime), the clock the
// captured frames are stamped with. Plain Node-API C calls; built by
// scripts/build-native.mjs.

#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <QuartzCore/QuartzCore.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#include <node_api.h>
#include <math.h>
#include <functional>
#include <mutex>
#include <string>
#include <vector>

// ---------------------------------------------------------------- Node-API helpers

static void Throw(napi_env env, const char* message) {
  napi_throw_error(env, nullptr, message);
}

static napi_value Undefined(napi_env env) {
  napi_value v;
  napi_get_undefined(env, &v);
  return v;
}

static napi_value Number(napi_env env, double value) {
  napi_value v;
  napi_create_double(env, value, &v);
  return v;
}

static napi_value String(napi_env env, NSString* value) {
  napi_value v;
  napi_create_string_utf8(env, value ? value.UTF8String : "", NAPI_AUTO_LENGTH, &v);
  return v;
}

static void Set(napi_env env, napi_value object, const char* key, napi_value value) {
  napi_set_named_property(env, object, key, value);
}

static bool GetProperty(napi_env env, napi_value object, const char* key, napi_value* out) {
  bool has = false;
  if (napi_has_named_property(env, object, key, &has) != napi_ok || !has) return false;
  if (napi_get_named_property(env, object, key, out) != napi_ok) return false;
  napi_valuetype type;
  napi_typeof(env, *out, &type);
  return type != napi_undefined && type != napi_null;
}

static bool GetNumber(napi_env env, napi_value object, const char* key, double* out) {
  napi_value v;
  if (!GetProperty(env, object, key, &v)) return false;
  return napi_get_value_double(env, v, out) == napi_ok && isfinite(*out);
}

static bool GetBool(napi_env env, napi_value object, const char* key, bool fallback) {
  napi_value v;
  bool out = fallback;
  if (GetProperty(env, object, key, &v)) napi_get_value_bool(env, v, &out);
  return out;
}

static NSString* GetString(napi_env env, napi_value object, const char* key) {
  napi_value v;
  if (!GetProperty(env, object, key, &v)) return nil;
  size_t length = 0;
  if (napi_get_value_string_utf8(env, v, nullptr, 0, &length) != napi_ok) return nil;
  std::string text(length, '\0');
  napi_get_value_string_utf8(env, v, text.data(), length + 1, &length);
  return [NSString stringWithUTF8String:text.c_str()];
}

/** A result for a JS callback, built on the JS thread. */
struct Completion {
  std::string error;
  std::function<napi_value(napi_env)> build;
};

static void CallJs(napi_env env, napi_value callback, void*, void* data) {
  Completion* completion = static_cast<Completion*>(data);
  if (env && callback) {
    napi_value args[2];
    if (!completion->error.empty()) {
      napi_value message;
      napi_create_string_utf8(env, completion->error.c_str(), NAPI_AUTO_LENGTH, &message);
      napi_create_error(env, nullptr, message, &args[0]);
      args[1] = Undefined(env);
    } else {
      napi_get_null(env, &args[0]);
      args[1] = completion->build ? completion->build(env) : Undefined(env);
    }
    napi_call_function(env, Undefined(env), callback, 2, args, nullptr);
  }
  delete completion;
}

static napi_threadsafe_function MakeCallback(napi_env env, napi_value callback, const char* name) {
  napi_value resource;
  napi_create_string_utf8(env, name, NAPI_AUTO_LENGTH, &resource);
  napi_threadsafe_function fn = nullptr;
  napi_create_threadsafe_function(env, callback, nullptr, resource, 0, 1, nullptr, nullptr, nullptr, CallJs, &fn);
  return fn;
}

/** Calls the JS callback once, from any thread, and lets it go. */
static void Finish(napi_threadsafe_function fn, Completion* completion) {
  napi_call_threadsafe_function(fn, completion, napi_tsfn_blocking);
  napi_release_threadsafe_function(fn, napi_tsfn_release);
}

static Completion* Failure(NSString* message) {
  Completion* c = new Completion();
  c->error = message.UTF8String;
  return c;
}

// ---------------------------------------------------------------- screens

static NSScreen* ScreenFor(CGDirectDisplayID displayId) {
  for (NSScreen* screen in NSScreen.screens) {
    NSNumber* number = screen.deviceDescription[@"NSScreenNumber"];
    if (number.unsignedIntValue == displayId) return screen;
  }
  return NSScreen.mainScreen;
}

static int Even(double value) {
  int rounded = (int)lround(value);
  return MAX(2, rounded - (rounded % 2));
}

// ---------------------------------------------------------------- recorder

/** The longest side written: H.264 tops out around 4K. */
static const double MAX_SIDE = 3840;

API_AVAILABLE(macos(13.0))
@interface XBRecorder : NSObject <SCStreamOutput, SCStreamDelegate>
@property(nonatomic, strong) SCStream* stream;
@property(nonatomic, strong) AVAssetWriter* writer;
@property(nonatomic, strong) AVAssetWriterInput* videoInput;
@property(nonatomic, strong) AVAssetWriterInput* systemInput;
@property(nonatomic, strong) AVAssetWriterInput* micInput;
@property(nonatomic, strong) dispatch_queue_t queue;
@property(nonatomic) BOOL started;
@property(nonatomic) BOOL paused;
@property(nonatomic) BOOL stopping;
@property(nonatomic) double firstHost;
@property(nonatomic) double offset;
@property(nonatomic) double pauseStart;
@property(nonatomic) double lastVideoHost;
@property(nonatomic) int64_t frames;
@property(nonatomic, strong) NSMutableArray<NSArray<NSNumber*>*>* pauses;
@property(nonatomic, copy) NSString* failure;
@end

@implementation XBRecorder {
  CMSampleBufferRef _lastVideo;
}

- (instancetype)init {
  if ((self = [super init])) {
    _queue = dispatch_queue_create("app.xbot.capture", DISPATCH_QUEUE_SERIAL);
    _pauses = [NSMutableArray array];
  }
  return self;
}

- (void)dealloc {
  if (_lastVideo) CFRelease(_lastVideo);
}

/** A copy of `buffer` moved `shift` seconds earlier. */
static CMSampleBufferRef Retimed(CMSampleBufferRef buffer, double shift) {
  CMItemCount count = 0;
  CMSampleBufferGetSampleTimingInfoArray(buffer, 0, nullptr, &count);
  std::vector<CMSampleTimingInfo> timing(MAX(count, 1));
  if (count > 0) CMSampleBufferGetSampleTimingInfoArray(buffer, count, timing.data(), &count);
  else {
    timing[0].duration = CMSampleBufferGetDuration(buffer);
    timing[0].presentationTimeStamp = CMSampleBufferGetPresentationTimeStamp(buffer);
    timing[0].decodeTimeStamp = kCMTimeInvalid;
    count = 1;
  }
  CMTime delta = CMTimeMakeWithSeconds(shift, 1000000000);
  for (CMItemCount i = 0; i < count; i++) {
    timing[i].presentationTimeStamp = CMTimeSubtract(timing[i].presentationTimeStamp, delta);
    if (CMTIME_IS_VALID(timing[i].decodeTimeStamp)) timing[i].decodeTimeStamp = CMTimeSubtract(timing[i].decodeTimeStamp, delta);
  }
  CMSampleBufferRef copy = nullptr;
  CMSampleBufferCreateCopyWithNewTiming(kCFAllocatorDefault, buffer, count, timing.data(), &copy);
  return copy;
}

- (void)stream:(SCStream*)stream didOutputSampleBuffer:(CMSampleBufferRef)buffer ofType:(SCStreamOutputType)type {
  if (!CMSampleBufferIsValid(buffer) || self.stopping || self.paused) return;
  if (type == SCStreamOutputTypeScreen) {
    CFArrayRef attachments = CMSampleBufferGetSampleAttachmentsArray(buffer, false);
    if (!attachments || CFArrayGetCount(attachments) == 0) return;
    CFDictionaryRef info = (CFDictionaryRef)CFArrayGetValueAtIndex(attachments, 0);
    CFNumberRef statusRef = (CFNumberRef)CFDictionaryGetValue(info, (__bridge CFStringRef)SCStreamFrameInfoStatus);
    int status = -1;
    if (!statusRef || !CFNumberGetValue(statusRef, kCFNumberIntType, &status) || status != SCFrameStatusComplete) return;
  }
  double host = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(buffer));
  if (!self.started) {
    if (type != SCStreamOutputTypeScreen) return;
    if (![self.writer startWriting]) {
      self.failure = self.writer.error.localizedDescription ?: @"Couldn’t start writing the recording.";
      return;
    }
    [self.writer startSessionAtSourceTime:CMSampleBufferGetPresentationTimeStamp(buffer)];
    self.started = YES;
    self.firstHost = host;
  }
  if (host < self.firstHost) return;

  AVAssetWriterInput* input = type == SCStreamOutputTypeScreen ? self.videoInput : type == SCStreamOutputTypeAudio ? self.systemInput : self.micInput;
  if (!input || !input.readyForMoreMediaData) return;
  CMSampleBufferRef retimed = Retimed(buffer, self.offset);
  if (!retimed) return;
  if ([input appendSampleBuffer:retimed] && type == SCStreamOutputTypeScreen) {
    self.frames += 1;
    self.lastVideoHost = host - self.offset;
    if (_lastVideo) CFRelease(_lastVideo);
    _lastVideo = retimed;
    return;
  }
  CFRelease(retimed);
}

- (void)stream:(SCStream*)stream didStopWithError:(NSError*)error {
  if (!self.stopping) self.failure = error.localizedDescription ?: @"The recording stopped.";
}

/** Repeats the last frame at `host` (shifted), so a still screen still lasts until the stop. */
- (void)holdLastFrameUntil:(double)host {
  if (!_lastVideo || host <= self.lastVideoHost + 0.001 || !self.videoInput.readyForMoreMediaData) return;
  CMSampleTimingInfo timing = {CMTimeMake(1, 60), CMTimeMakeWithSeconds(host, 1000000000), kCMTimeInvalid};
  CMSampleBufferRef copy = nullptr;
  if (CMSampleBufferCreateCopyWithNewTiming(kCFAllocatorDefault, _lastVideo, 1, &timing, &copy) == noErr && copy) {
    [self.videoInput appendSampleBuffer:copy];
    CFRelease(copy);
  }
}

- (void)finishWithEndHost:(double)endHost completion:(void (^)(NSString* error))done {
  dispatch_async(self.queue, ^{
    if (!self.started) {
      done(self.failure ?: @"Nothing was recorded.");
      return;
    }
    double end = endHost - self.offset;
    [self holdLastFrameUntil:end - 1.0 / 60];
    [self.videoInput markAsFinished];
    [self.systemInput markAsFinished];
    [self.micInput markAsFinished];
    [self.writer endSessionAtSourceTime:CMTimeMakeWithSeconds(end, 1000000000)];
    [self.writer finishWritingWithCompletionHandler:^{
      done(self.writer.status == AVAssetWriterStatusCompleted ? nil : (self.writer.error.localizedDescription ?: @"Couldn’t finish the recording."));
    }];
  });
}
@end

static XBRecorder* gRecorder API_AVAILABLE(macos(13.0)) = nil;

static NSDictionary* AudioSettings(int channels, int bitrate) {
  return @{
    AVFormatIDKey : @(kAudioFormatMPEG4AAC),
    AVSampleRateKey : @48000,
    AVNumberOfChannelsKey : @(channels),
    AVEncoderBitRateKey : @(bitrate),
  };
}

// startCapture({ displayId, windowId?, rect?, output, fps, systemAudio, microphoneId? }, (err, { width, height, scale, bounds }) => void)
// `bounds` is the captured area in global points, top-left origin (where cursor positions are measured).
static napi_value StartCapture(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 2) {
    Throw(env, "startCapture(options, callback)");
    return nullptr;
  }
  if (@available(macOS 13.0, *)) {
  } else {
    Throw(env, "Recording needs macOS 13 or later.");
    return nullptr;
  }
  if (gRecorder) {
    Throw(env, "A recording is already running.");
    return nullptr;
  }

  double displayId = 0, windowId = 0, fps = 60;
  GetNumber(env, argv[0], "displayId", &displayId);
  GetNumber(env, argv[0], "windowId", &windowId);
  GetNumber(env, argv[0], "fps", &fps);
  NSString* output = GetString(env, argv[0], "output");
  NSString* microphoneId = GetString(env, argv[0], "microphoneId");
  bool systemAudio = GetBool(env, argv[0], "systemAudio", false);
  bool hasRect = false;
  CGRect rect = CGRectZero;
  napi_value rectValue;
  if (GetProperty(env, argv[0], "rect", &rectValue)) {
    double x = 0, y = 0, w = 0, h = 0;
    hasRect = GetNumber(env, rectValue, "x", &x) && GetNumber(env, rectValue, "y", &y) && GetNumber(env, rectValue, "width", &w) && GetNumber(env, rectValue, "height", &h) && w >= 2 && h >= 2;
    rect = CGRectMake(x, y, w, h);
  }
  if (!output) {
    Throw(env, "startCapture: output is required");
    return nullptr;
  }
  napi_threadsafe_function callback = MakeCallback(env, argv[1], "xbot-capture-start");

  if (@available(macOS 13.0, *)) {
    XBRecorder* recorder = [XBRecorder new];
    gRecorder = recorder;
    [SCShareableContent getShareableContentExcludingDesktopWindows:NO
                                               onScreenWindowsOnly:YES
                                                 completionHandler:^(SCShareableContent* content, NSError* error) {
      if (!content) {
        gRecorder = nil;
        Finish(callback, Failure(error.code == SCStreamErrorUserDeclined ? @"permission" : (error.localizedDescription ?: @"Couldn’t list the screens.")));
        return;
      }
      SCRunningApplication* me = nil;
      for (SCRunningApplication* app in content.applications) {
        if (app.processID == NSProcessInfo.processInfo.processIdentifier) me = app;
      }
      SCContentFilter* filter = nil;
      CGSize points = CGSizeZero;
      CGRect bounds = CGRectZero;
      CGDirectDisplayID screenId = (CGDirectDisplayID)displayId;
      if (windowId > 0) {
        for (SCWindow* window in content.windows) {
          if (window.windowID == (CGWindowID)windowId) {
            filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:window];
            points = window.frame.size;
            bounds = window.frame;
          }
        }
      } else {
        for (SCDisplay* display in content.displays) {
          if (display.displayID == screenId || (screenId == 0 && display.displayID == CGMainDisplayID())) {
            filter = [[SCContentFilter alloc] initWithDisplay:display excludingApplications:(me ? @[ me ] : @[]) exceptingWindows:@[]];
            points = CGSizeMake(display.width, display.height);
            screenId = display.displayID;
            bounds = display.frame;
          }
        }
      }
      if (!filter) {
        gRecorder = nil;
        Finish(callback, Failure(windowId > 0 ? @"That window is no longer on screen." : @"That display is no longer connected."));
        return;
      }

      double scale = ScreenFor(screenId ?: CGMainDisplayID()).backingScaleFactor;
      if (@available(macOS 14.0, *)) scale = filter.pointPixelScale;
      SCStreamConfiguration* config = [SCStreamConfiguration new];
      CGSize source = hasRect ? rect.size : points;
      double fit = MIN(1.0, MAX_SIDE / (MAX(source.width, source.height) * scale));
      int width = Even(source.width * scale * fit);
      int height = Even(source.height * scale * fit);
      if (hasRect) {
        config.sourceRect = rect;
        bounds = CGRectMake(bounds.origin.x + rect.origin.x, bounds.origin.y + rect.origin.y, rect.size.width, rect.size.height);
      }
      config.width = width;
      config.height = height;
      config.minimumFrameInterval = CMTimeMake(1, (int32_t)MAX(1, MIN(120, fps)));
      config.showsCursor = NO;
      config.queueDepth = 6;
      config.pixelFormat = kCVPixelFormatType_32BGRA;
      config.colorSpaceName = kCGColorSpaceSRGB;
      if (systemAudio) {
        config.capturesAudio = YES;
        config.excludesCurrentProcessAudio = YES;
        config.sampleRate = 48000;
        config.channelCount = 2;
      }
      bool microphone = false;
      if (@available(macOS 15.0, *)) {
        if (microphoneId.length > 0) {
          config.captureMicrophone = YES;
          config.microphoneCaptureDeviceID = microphoneId;
          microphone = true;
        }
      }

      NSURL* url = [NSURL fileURLWithPath:output];
      [NSFileManager.defaultManager removeItemAtURL:url error:nil];
      NSError* writerError = nil;
      recorder.writer = [[AVAssetWriter alloc] initWithURL:url fileType:AVFileTypeMPEG4 error:&writerError];
      if (!recorder.writer) {
        gRecorder = nil;
        Finish(callback, Failure(writerError.localizedDescription ?: @"Couldn’t create the recording file."));
        return;
      }
      NSDictionary* video = @{
        AVVideoCodecKey : AVVideoCodecTypeH264,
        AVVideoWidthKey : @(width),
        AVVideoHeightKey : @(height),
        AVVideoColorPropertiesKey : @{
          AVVideoColorPrimariesKey : AVVideoColorPrimaries_ITU_R_709_2,
          AVVideoTransferFunctionKey : AVVideoTransferFunction_ITU_R_709_2,
          AVVideoYCbCrMatrixKey : AVVideoYCbCrMatrix_ITU_R_709_2,
        },
        AVVideoCompressionPropertiesKey : @{
          AVVideoAverageBitRateKey : @((double)width * height * 2.5),
          AVVideoExpectedSourceFrameRateKey : @(fps),
          AVVideoMaxKeyFrameIntervalKey : @((int)fps * 2),
          AVVideoProfileLevelKey : AVVideoProfileLevelH264HighAutoLevel,
          AVVideoAllowFrameReorderingKey : @NO,
        },
      };
      recorder.videoInput = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo outputSettings:video];
      recorder.videoInput.expectsMediaDataInRealTime = YES;
      [recorder.writer addInput:recorder.videoInput];
      if (systemAudio) {
        recorder.systemInput = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeAudio outputSettings:AudioSettings(2, 192000)];
        recorder.systemInput.expectsMediaDataInRealTime = YES;
        [recorder.writer addInput:recorder.systemInput];
      }
      if (microphone) {
        recorder.micInput = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeAudio outputSettings:AudioSettings(1, 128000)];
        recorder.micInput.expectsMediaDataInRealTime = YES;
        [recorder.writer addInput:recorder.micInput];
      }

      recorder.stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:recorder];
      NSError* outputError = nil;
      [recorder.stream addStreamOutput:recorder type:SCStreamOutputTypeScreen sampleHandlerQueue:recorder.queue error:&outputError];
      if (systemAudio) [recorder.stream addStreamOutput:recorder type:SCStreamOutputTypeAudio sampleHandlerQueue:recorder.queue error:&outputError];
      if (@available(macOS 15.0, *)) {
        if (microphone) [recorder.stream addStreamOutput:recorder type:SCStreamOutputTypeMicrophone sampleHandlerQueue:recorder.queue error:&outputError];
      }
      if (outputError) {
        gRecorder = nil;
        Finish(callback, Failure(outputError.localizedDescription));
        return;
      }
      [recorder.stream startCaptureWithCompletionHandler:^(NSError* startError) {
        if (startError) {
          gRecorder = nil;
          Finish(callback, Failure(startError.code == SCStreamErrorUserDeclined ? @"permission" : startError.localizedDescription));
          return;
        }
        Completion* done = new Completion();
        done->build = [width, height, scale, fit, bounds](napi_env env) {
          napi_value result, area;
          napi_create_object(env, &result);
          napi_create_object(env, &area);
          Set(env, area, "x", Number(env, bounds.origin.x));
          Set(env, area, "y", Number(env, bounds.origin.y));
          Set(env, area, "width", Number(env, bounds.size.width));
          Set(env, area, "height", Number(env, bounds.size.height));
          Set(env, result, "bounds", area);
          Set(env, result, "width", Number(env, width));
          Set(env, result, "height", Number(env, height));
          Set(env, result, "scale", Number(env, scale * fit));
          return result;
        };
        Finish(callback, done);
      }];
    }];
  }
  return Undefined(env);
}

static napi_value PauseCapture(napi_env env, napi_callback_info) {
  if (@available(macOS 13.0, *)) {
    XBRecorder* recorder = gRecorder;
    if (recorder) {
      dispatch_sync(recorder.queue, ^{
        if (recorder.paused) return;
        recorder.paused = YES;
        recorder.pauseStart = CACurrentMediaTime();
      });
    }
  }
  return Undefined(env);
}

static napi_value ResumeCapture(napi_env env, napi_callback_info) {
  if (@available(macOS 13.0, *)) {
    XBRecorder* recorder = gRecorder;
    if (recorder) {
      dispatch_sync(recorder.queue, ^{
        if (!recorder.paused) return;
        double now = CACurrentMediaTime();
        [recorder.pauses addObject:@[ @(recorder.pauseStart), @(now) ]];
        recorder.offset += now - recorder.pauseStart;
        recorder.paused = NO;
      });
    }
  }
  return Undefined(env);
}

// stopCapture((err, { firstHost, endHost, pauses: [start, end][], frames }) => void)
static napi_value StopCapture(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  if (argc < 1) {
    Throw(env, "stopCapture(callback)");
    return nullptr;
  }
  napi_threadsafe_function callback = MakeCallback(env, argv[0], "xbot-capture-stop");
  if (@available(macOS 13.0, *)) {
    XBRecorder* recorder = gRecorder;
    if (!recorder) {
      Finish(callback, Failure(@"No recording is running."));
      return Undefined(env);
    }
    double endHost = CACurrentMediaTime();
    dispatch_sync(recorder.queue, ^{
      if (recorder.paused) {
        [recorder.pauses addObject:@[ @(recorder.pauseStart), @(endHost) ]];
        recorder.offset += endHost - recorder.pauseStart;
        recorder.paused = NO;
      }
      recorder.stopping = YES;
    });
    void (^finish)(void) = ^{
      [recorder finishWithEndHost:endHost
                       completion:^(NSString* error) {
                         gRecorder = nil;
                         if (error) {
                           Finish(callback, Failure(error));
                           return;
                         }
                         double first = recorder.firstHost;
                         int64_t frames = recorder.frames;
                         std::vector<std::pair<double, double>> pauses;
                         for (NSArray<NSNumber*>* pause in recorder.pauses) pauses.emplace_back(pause[0].doubleValue, pause[1].doubleValue);
                         Completion* done = new Completion();
                         done->build = [first, endHost, frames, pauses](napi_env env) {
                           napi_value result, list;
                           napi_create_object(env, &result);
                           Set(env, result, "firstHost", Number(env, first));
                           Set(env, result, "endHost", Number(env, endHost));
                           Set(env, result, "frames", Number(env, (double)frames));
                           napi_create_array_with_length(env, pauses.size(), &list);
                           for (size_t i = 0; i < pauses.size(); i++) {
                             napi_value pair;
                             napi_create_array_with_length(env, 2, &pair);
                             napi_set_element(env, pair, 0, Number(env, pauses[i].first));
                             napi_set_element(env, pair, 1, Number(env, pauses[i].second));
                             napi_set_element(env, list, i, pair);
                           }
                           Set(env, result, "pauses", list);
                           return result;
                         };
                         Finish(callback, done);
                       }];
    };
    [recorder.stream stopCaptureWithCompletionHandler:^(NSError*) {
      finish();
    }];
  } else {
    Finish(callback, Failure(@"Recording needs macOS 13 or later."));
  }
  return Undefined(env);
}

// ---------------------------------------------------------------- cursor

struct CursorEvent {
  double t;
  double x;
  double y;
  int type;  // 0 move, 1 down, 2 up
  int button;
  int cursor;
};

struct CursorImage {
  int id;
  uint64_t hash;
  NSData* png;
  double hotX;
  double hotY;
  double width;
  double height;
};

static std::mutex gCursorLock;
static std::vector<CursorEvent> gEvents;
static std::vector<CursorImage> gCursors;
static id gGlobalMonitor = nil;
static id gLocalMonitor = nil;
static int gCurrentCursor = -1;
static double gLastCursorCheck = 0;

static uint64_t Fnv(NSData* data) {
  uint64_t hash = 1469598103934665603ULL;
  const uint8_t* bytes = (const uint8_t*)data.bytes;
  for (NSUInteger i = 0; i < data.length; i++) hash = (hash ^ bytes[i]) * 1099511628211ULL;
  return hash;
}

/** The id of the cursor image showing now, adding it the first time it is seen. Main thread. */
static int CurrentCursor(bool force) {
  double now = CACurrentMediaTime();
  if (!force && gCurrentCursor >= 0 && now - gLastCursorCheck < 0.05) return gCurrentCursor;
  gLastCursorCheck = now;
  NSCursor* cursor = [NSCursor currentSystemCursor];
  NSImage* image = cursor.image;
  if (!image) return gCurrentCursor;
  NSData* tiff = image.TIFFRepresentation;
  if (!tiff) return gCurrentCursor;
  uint64_t hash = Fnv(tiff);
  for (const CursorImage& known : gCursors) {
    if (known.hash == hash) return gCurrentCursor = known.id;
  }
  // The sharpest representation (the @2x one on Retina), so a zoomed cursor stays crisp.
  NSBitmapImageRep* rep = nil;
  for (NSImageRep* candidate in [NSBitmapImageRep imageRepsWithData:tiff]) {
    if ([candidate isKindOfClass:[NSBitmapImageRep class]] && (!rep || candidate.pixelsWide > rep.pixelsWide)) rep = (NSBitmapImageRep*)candidate;
  }
  NSData* png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  if (!png) return gCurrentCursor;
  CursorImage entry = {(int)gCursors.size(), hash, png, cursor.hotSpot.x, cursor.hotSpot.y, image.size.width, image.size.height};
  gCursors.push_back(entry);
  return gCurrentCursor = entry.id;
}

static void RecordEvent(NSEvent* event) {
  int type = 0;
  int button = 0;
  switch (event.type) {
    case NSEventTypeLeftMouseDown:
      type = 1;
      break;
    case NSEventTypeRightMouseDown:
      type = 1;
      button = 1;
      break;
    case NSEventTypeLeftMouseUp:
      type = 2;
      break;
    case NSEventTypeRightMouseUp:
      type = 2;
      button = 1;
      break;
    default:
      break;
  }
  NSPoint point = NSEvent.mouseLocation;
  double top = NSScreen.screens.count > 0 ? NSScreen.screens[0].frame.size.height : 0;
  int cursor = CurrentCursor(type != 0);
  std::lock_guard<std::mutex> lock(gCursorLock);
  gEvents.push_back({CACurrentMediaTime(), point.x, top - point.y, type, button, cursor});
}

static napi_value StartCursor(napi_env env, napi_callback_info) {
  if (gGlobalMonitor) return Undefined(env);
  {
    std::lock_guard<std::mutex> lock(gCursorLock);
    gEvents.clear();
  }
  gCursors.clear();
  gCurrentCursor = -1;
  NSEventMask mask = NSEventMaskMouseMoved | NSEventMaskLeftMouseDragged | NSEventMaskRightMouseDragged | NSEventMaskOtherMouseDragged |
                     NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp | NSEventMaskRightMouseDown | NSEventMaskRightMouseUp;
  gGlobalMonitor = [NSEvent addGlobalMonitorForEventsMatchingMask:mask handler:^(NSEvent* event) { RecordEvent(event); }];
  gLocalMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:mask
                                                        handler:^NSEvent*(NSEvent* event) {
                                                          RecordEvent(event);
                                                          return event;
                                                        }];
  // Where the cursor starts, even if it never moves.
  NSPoint point = NSEvent.mouseLocation;
  double top = NSScreen.screens.count > 0 ? NSScreen.screens[0].frame.size.height : 0;
  int cursor = CurrentCursor(true);
  std::lock_guard<std::mutex> lock(gCursorLock);
  gEvents.push_back({CACurrentMediaTime(), point.x, top - point.y, 0, 0, cursor});
  return Undefined(env);
}

// stopCursor(): { events: { t, x, y, type, button, cursor }[], cursors: { id, png, hotX, hotY, width, height }[] }
static napi_value StopCursor(napi_env env, napi_callback_info) {
  if (gGlobalMonitor) [NSEvent removeMonitor:gGlobalMonitor];
  if (gLocalMonitor) [NSEvent removeMonitor:gLocalMonitor];
  gGlobalMonitor = nil;
  gLocalMonitor = nil;
  std::vector<CursorEvent> events;
  {
    std::lock_guard<std::mutex> lock(gCursorLock);
    events.swap(gEvents);
  }
  napi_value result, list, images;
  napi_create_object(env, &result);
  napi_create_array_with_length(env, events.size(), &list);
  for (size_t i = 0; i < events.size(); i++) {
    napi_value item;
    napi_create_object(env, &item);
    Set(env, item, "t", Number(env, events[i].t));
    Set(env, item, "x", Number(env, events[i].x));
    Set(env, item, "y", Number(env, events[i].y));
    Set(env, item, "type", Number(env, events[i].type));
    Set(env, item, "button", Number(env, events[i].button));
    Set(env, item, "cursor", Number(env, events[i].cursor));
    napi_set_element(env, list, i, item);
  }
  napi_create_array_with_length(env, gCursors.size(), &images);
  for (size_t i = 0; i < gCursors.size(); i++) {
    const CursorImage& image = gCursors[i];
    napi_value item, buffer;
    void* data = nullptr;
    napi_create_object(env, &item);
    napi_create_buffer_copy(env, image.png.length, image.png.bytes, &data, &buffer);
    Set(env, item, "id", Number(env, image.id));
    Set(env, item, "png", buffer);
    Set(env, item, "hotX", Number(env, image.hotX));
    Set(env, item, "hotY", Number(env, image.hotY));
    Set(env, item, "width", Number(env, image.width));
    Set(env, item, "height", Number(env, image.height));
    napi_set_element(env, images, i, item);
  }
  gCursors.clear();
  Set(env, result, "events", list);
  Set(env, result, "cursors", images);
  return result;
}

// ---------------------------------------------------------------- everything else

static napi_value HostTime(napi_env env, napi_callback_info) {
  return Number(env, CACurrentMediaTime());
}

static napi_value ScreenPermission(napi_env env, napi_callback_info) {
  napi_value v;
  napi_get_boolean(env, CGPreflightScreenCaptureAccess(), &v);
  return v;
}

static napi_value RequestScreenPermission(napi_env env, napi_callback_info) {
  napi_value v;
  napi_get_boolean(env, CGRequestScreenCaptureAccess(), &v);
  return v;
}

static napi_value Supported(napi_env env, napi_callback_info) {
  napi_value v;
  bool supported = false;
  if (@available(macOS 13.0, *)) supported = true;
  napi_get_boolean(env, supported, &v);
  return v;
}

static napi_value MicrophoneSupported(napi_env env, napi_callback_info) {
  napi_value v;
  bool supported = false;
  if (@available(macOS 15.0, *)) supported = true;
  napi_get_boolean(env, supported, &v);
  return v;
}

// microphones(): { id, name }[]
static napi_value Microphones(napi_env env, napi_callback_info) {
  NSArray<AVCaptureDeviceType>* types = @[ AVCaptureDeviceTypeBuiltInMicrophone, AVCaptureDeviceTypeExternalUnknown ];
  if (@available(macOS 14.0, *)) types = @[ AVCaptureDeviceTypeMicrophone, AVCaptureDeviceTypeExternal ];
  AVCaptureDeviceDiscoverySession* session = [AVCaptureDeviceDiscoverySession discoverySessionWithDeviceTypes:types mediaType:AVMediaTypeAudio position:AVCaptureDevicePositionUnspecified];
  NSArray<AVCaptureDevice*>* devices = session.devices;
  napi_value list;
  napi_create_array_with_length(env, devices.count, &list);
  for (NSUInteger i = 0; i < devices.count; i++) {
    napi_value item;
    napi_create_object(env, &item);
    Set(env, item, "id", String(env, devices[i].uniqueID));
    Set(env, item, "name", String(env, devices[i].localizedName));
    napi_set_element(env, list, i, item);
  }
  return list;
}

// desktopWallpaper(displayId): string | null
static napi_value DesktopWallpaper(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  double displayId = 0;
  if (argc > 0) napi_get_value_double(env, argv[0], &displayId);
  NSScreen* screen = ScreenFor(displayId > 0 ? (CGDirectDisplayID)displayId : CGMainDisplayID());
  NSURL* url = screen ? [NSWorkspace.sharedWorkspace desktopImageURLForScreen:screen] : nil;
  if (!url.path) {
    napi_value v;
    napi_get_null(env, &v);
    return v;
  }
  return String(env, url.path);
}

// desktopWallpaperJpeg(displayId): Buffer | null — the desktop picture as a JPEG (macOS reads HEIC; Chromium can't).
static napi_value DesktopWallpaperJpeg(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  double displayId = 0;
  if (argc > 0) napi_get_value_double(env, argv[0], &displayId);
  napi_value none;
  napi_get_null(env, &none);
  NSScreen* screen = ScreenFor(displayId > 0 ? (CGDirectDisplayID)displayId : CGMainDisplayID());
  NSURL* url = screen ? [NSWorkspace.sharedWorkspace desktopImageURLForScreen:screen] : nil;
  if (!url) return none;
  NSImage* image = [[NSImage alloc] initWithContentsOfURL:url];
  CGImageRef cg = image ? [image CGImageForProposedRect:nullptr context:nil hints:nil] : nullptr;
  if (!cg) return none;
  NSBitmapImageRep* rep = [[NSBitmapImageRep alloc] initWithCGImage:cg];
  NSData* jpeg = [rep representationUsingType:NSBitmapImageFileTypeJPEG properties:@{NSImageCompressionFactor : @0.92}];
  if (!jpeg) return none;
  napi_value buffer;
  void* data = nullptr;
  napi_create_buffer_copy(env, jpeg.length, jpeg.bytes, &data, &buffer);
  return buffer;
}

NAPI_MODULE_INIT() {
  struct Entry {
    const char* name;
    napi_callback fn;
  } entries[] = {
      {"supported", Supported},
      {"microphoneSupported", MicrophoneSupported},
      {"screenPermission", ScreenPermission},
      {"requestScreenPermission", RequestScreenPermission},
      {"hostTime", HostTime},
      {"microphones", Microphones},
      {"desktopWallpaper", DesktopWallpaper},
      {"desktopWallpaperJpeg", DesktopWallpaperJpeg},
      {"startCapture", StartCapture},
      {"pauseCapture", PauseCapture},
      {"resumeCapture", ResumeCapture},
      {"stopCapture", StopCapture},
      {"startCursor", StartCursor},
      {"stopCursor", StopCursor},
  };
  for (const Entry& entry : entries) {
    napi_value fn;
    napi_create_function(env, entry.name, NAPI_AUTO_LENGTH, entry.fn, nullptr, &fn);
    napi_set_named_property(env, exports, entry.name, fn);
  }
  return exports;
}
