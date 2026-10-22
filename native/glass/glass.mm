// xBot's native glass (see docs/ARCHITECTURE.md → "Native material").
//
// Electron 45 gives no control over its vibrancy view's opacity or corner
// radius, so this addon sets both with public AppKit API only:
// NSView.alphaValue fades the behind-window frost (the web content above it
// stays fully opaque) and NSVisualEffectView.maskImage gives it rounded
// corners. Plain Node-API C calls: ABI-stable, so one build serves every
// Electron version. Built by scripts/build-glass.mjs.

#import <AppKit/AppKit.h>
#include <math.h>
#include <string.h>
#include <node_api.h>

static void Throw(napi_env env, const char* message) {
  napi_throw_type_error(env, nullptr, message);
}

static bool ReadNumber(napi_env env, napi_value value, double* out) {
  napi_valuetype type;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_number) return false;
  return napi_get_value_double(env, value, out) == napi_ok && isfinite(*out);
}

/** Every behind-window effect view under `view`, found by class (not by position). */
static void CollectBehindWindowViews(NSView* view, NSMutableArray<NSVisualEffectView*>* out) {
  if ([view isKindOfClass:[NSVisualEffectView class]]) {
    NSVisualEffectView* effect = (NSVisualEffectView*)view;
    if (effect.blendingMode == NSVisualEffectBlendingModeBehindWindow) [out addObject:effect];
  }
  for (NSView* sub in view.subviews) CollectBehindWindowViews(sub, out);
}

/** A (2r+1)² rounded rect whose cap insets let AppKit stretch it to any size and redraw it at any scale. */
static NSImage* RoundedMask(CGFloat radius) {
  CGFloat side = 2 * radius + 1;
  NSImage* mask = [NSImage imageWithSize:NSMakeSize(side, side)
                                 flipped:NO
                          drawingHandler:^BOOL(NSRect rect) {
                            [[NSColor blackColor] setFill];
                            [[NSBezierPath bezierPathWithRoundedRect:rect xRadius:radius yRadius:radius] fill];
                            return YES;
                          }];
  mask.capInsets = NSEdgeInsetsMake(radius, radius, radius, radius);
  mask.resizingMode = NSImageResizingModeStretch;
  return mask;
}

// setGlass(handle: Buffer, alpha: number, radius: number): number
// `handle` is BrowserWindow.getNativeWindowHandle() (an NSView*). Returns how
// many effect views were changed; 0 means Electron's view was not found.
static napi_value SetGlass(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc < 3) {
    Throw(env, "setGlass(handle, alpha, radius): 3 arguments required");
    return nullptr;
  }

  bool isBuffer = false;
  void* data = nullptr;
  size_t length = 0;
  if (napi_is_buffer(env, argv[0], &isBuffer) != napi_ok || !isBuffer ||
      napi_get_buffer_info(env, argv[0], &data, &length) != napi_ok || length != sizeof(void*)) {
    Throw(env, "setGlass: handle must be getNativeWindowHandle()'s Buffer");
    return nullptr;
  }
  double alpha = 0;
  double radius = 0;
  if (!ReadNumber(env, argv[1], &alpha) || alpha < 0 || alpha > 1) {
    Throw(env, "setGlass: alpha must be a number from 0 to 1");
    return nullptr;
  }
  if (!ReadNumber(env, argv[2], &radius) || radius < 0 || radius > 200) {
    Throw(env, "setGlass: radius must be a number from 0 to 200");
    return nullptr;
  }

  void* pointer = nullptr;
  memcpy(&pointer, data, sizeof(void*));
  NSView* handle = (__bridge NSView*)pointer;
  NSWindow* window = [handle isKindOfClass:[NSView class]] ? handle.window : nil;

  NSMutableArray<NSVisualEffectView*>* views = [NSMutableArray array];
  if (window.contentView) CollectBehindWindowViews(window.contentView, views);
  NSImage* mask = radius > 0 ? RoundedMask(radius) : nil;
  for (NSVisualEffectView* view in views) {
    view.alphaValue = alpha;
    view.maskImage = mask;
  }
  if (views.count > 0) [window invalidateShadow];

  napi_value result;
  napi_create_uint32(env, (uint32_t)views.count, &result);
  return result;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "setGlass", NAPI_AUTO_LENGTH, SetGlass, nullptr, &fn);
  napi_set_named_property(env, exports, "setGlass", fn);
  return exports;
}
