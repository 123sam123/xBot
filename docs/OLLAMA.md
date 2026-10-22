# Local AI with Ollama

xBot's AI runs only through **native Ollama on this Mac**. Every call goes from
the main process to a loopback endpoint (default `http://127.0.0.1:11434`).
There is no hosted fallback, no API key and no per-request fee. AI does use
this Mac's memory, compute, storage and power, and small models write weaker
drafts than big hosted ones.

This page records the Ollama behaviour xBot relies on, as verified on
**2026-10-21**. The sources were docs.ollama.com (api/tags,
api-reference/show-model-details, api/chat, api/pull, api/ps, api/errors,
api/streaming, capabilities/thinking, capabilities/structured-outputs, faq,
cloud) and Ollama's Go source on `main` (`api/types.go`, `api/client.go`,
`server/routes.go`, `server/sched.go`, `server/prompt.go`,
`server/download.go`, `llm/llama_server.go`, `internal/cloud/policy.go`,
`internal/modelref/modelref.go`). The code lives in `src/main/services/ai/`
(see "Local AI" in [ARCHITECTURE.md](ARCHITECTURE.md)).

## Setup

1. Install Ollama from <https://ollama.com/download> and open it. It listens
   on `127.0.0.1:11434` by default.
2. In xBot, open **Settings → Local AI** or follow the onboarding steps.
   - If a suitable model is already installed, xBot picks it: `gemma3:4b` if
     present, otherwise the first catalog model, otherwise the smallest local
     model.
   - Otherwise, choose one of the suggested downloads. A download starts only
     when you click **Download**; it shows progress and can be cancelled and
     retried.
3. Optional but recommended: turn on Ollama's local-only mode (below).

### Local-only (cloud-disabled) mode

Ollama can also run cloud models. xBot refuses them on its own (see
"Locality"), and you can switch Ollama's cloud features off entirely:

- add `{"disable_ollama_cloud": true}` to `~/.ollama/server.json`, or
- set `OLLAMA_NO_CLOUD=1`. For the macOS app, run
  `launchctl setenv OLLAMA_NO_CLOUD 1`.

Then quit and reopen Ollama. Its log shows `Ollama cloud disabled: true`, and
`GET /api/status` reports `{"cloud":{"disabled":true,"source":"config"|"env"|"both"}}`.
xBot shows that status when Ollama reports it. xBot never writes `~/.ollama`
or changes Ollama's configuration; you turn this on yourself.

### Suggested models

Verified on ollama.com/library on 2026-10-21. The list is filtered by this
Mac's memory (`os.totalmem()`).

| Model | Download | Shown from | Memory while writing (approx.) |
|---|---|---|---|
| `gemma3:4b` (recommended) | 3.4 GB | 8 GB RAM | about 5 GB |
| `llama3.2:3b` | 2.0 GB | 8 GB RAM | about 3 GB |
| `gemma3:1b` | 806 MB | 4 GB RAM | about 1.5 GB (fastest, weakest drafts) |
| `gemma3:12b` | 8.2 GB | 16 GB RAM | about 10 GB (best drafts, slower) |

Only these names can be downloaded from inside xBot. Any other installed model
can be selected, as long as it passes the locality check.

## API behaviour xBot relies on

| Endpoint | What xBot uses |
|---|---|
| `GET /api/version` | `{version}`. Reachability check. |
| `GET /api/status` | Undocumented; Go's client calls it "experimental". `{cloud:{disabled, source: none\|env\|config\|both}}`. Informational only, never a gate. |
| `GET /api/tags` | `models[]` of `{name, model, remote_model?, remote_host?, modified_at, size, digest, details{format, family, families, parameter_size, quantization_level}, capabilities?}`. `capabilities` is in Go's `ListModelResponse` but not on the docs page, so xBot treats it as optional. |
| `POST /api/show {model}` | `{capabilities[], details, model_info, thinking?{values, default}, remote_model?, remote_host?, …}`. Capability values: `completion, tools, insert, vision, embedding, thinking, image, audio, decision`. |
| `GET /api/ps` | `models[]` of `{name, model, size, digest, details, expires_at, size_vram, context_length}`. |
| `POST /api/chat` | Streaming generation (below). |
| `POST /api/pull {model, stream}` | NDJSON `{status, digest?, total?, completed?}` lines, one set per layer, ending in `status:"success"`. |

### Chat requests

- **`stream`** defaults to true. The reply is `application/x-ndjson`, one JSON
  object per line, with `message.content`, `message.thinking?` and `done`.
  The final chunk also carries `done_reason` (`"stop"` or `"length"`).
  Go's `ChatResponse` adds `remote_model?` and `remote_host?` to every chunk;
  xBot aborts if either is ever set.
- **`format`** is `"json"` or a JSON schema object. xBot sends a schema
  generated from its zod schemas (`z.toJSONSchema`, with `$schema` removed),
  states the shape in the prompt as the docs recommend, and still validates
  the result with zod.
- **`think`** is a bool, a model-defined level string, or null. xBot sends
  `think:false` only when `/api/show` lists the `thinking` capability, and
  strips any `<think>…</think>` text a model leaks anyway.
- **`keep_alive`** is a duration string (`"5m"`, `"300s"`) or a number. `0`
  unloads the model right after the response, and a negative value means
  "keep forever". The default is 5 minutes. Every request resets the model's
  expiry to that request's value.
- **`options`**: xBot sends `num_ctx`, `num_predict` and `temperature`.
  `num_ctx` is a load-time runner option, so a request whose `num_ctx`
  differs from a loaded runner's reloads that model. Ollama's default context
  is 4096; it is 32768 with 23 GiB or more of GPU memory and 262144 with
  47 GiB or more (`routes.go`).
- **`truncate`** defaults to true, which silently drops older messages
  (system messages are kept) when the prompt is too long. xBot sends
  `truncate:false` and keeps its own input budget. An over-long prompt then
  fails with a 4xx whose error mentions the context length or size; xBot maps
  that to "too much text".
- **`shift`** defaults to true. xBot never sends it, because a value that
  differs from the loaded runner's makes Ollama reload the model
  (`sched.go needsReload`).

### Errors

Errors come as a JSON body, `{"error":"…"}`. An error that happens mid-stream
arrives as an `{"error":"…"}` NDJSON line, and the HTTP status stays what it
was. Cloud requests refused in cloud-disabled mode start with
`ollama cloud is disabled`.

### Cancellation

Aborting the HTTP request cancels Ollama's request context.
`llm/llama_server.go` checks `ctx.Done()` inside its streaming loop, returns,
and logs `aborting chat request due to client closing the connection`. So
**Cancel aborts the `fetch`**, and generation stops on Ollama's side.

`/api/pull` also runs on the request context, so aborting it cancels the
download. Partial blobs are kept as `-partial` files, and the next pull
resumes them, which is how Retry works.

Checked live on 2026-10-21 against Ollama 0.40.8 with `gemma3:4b`, run from a
throwaway directory on the build box. A streaming request with
`num_predict: 2000` was aborted after 20 chunks (0.81 s); Ollama's request log
shows it ended at 0.80 s instead of generating on. xBot's side (the socket
closes within 1 s of Cancel) is also tested against a mock server in
`tests/unit/ai-service.test.ts`.

The same live run confirmed the following:
- `/api/tags` and `/api/show` report `capabilities: ["completion", "vision"]`
  for `gemma3:4b` on 0.40.8 (0.31.1 reported `["completion"]`).
- A missing model answers 404 `model '…' not found`.
- With `OLLAMA_NO_CLOUD=1`, a cloud model answers 403
  `ollama cloud is disabled: remote model is unavailable`, the log shows
  `Ollama cloud disabled: true`, and `/api/status` reports
  `{"cloud":{"disabled":true,"source":"env"}}`.

### Concurrency and memory

- `OLLAMA_NUM_PARALLEL` defaults to 1, and `OLLAMA_MAX_QUEUE` to 512. xBot's
  request can wait in Ollama's queue behind another app's generation, and
  that wait counts toward xBot's timeout.
- `OLLAMA_MAX_LOADED_MODELS` defaults to 3 per GPU (3 on CPU and Apple
  Silicon). When memory runs short, Ollama unloads an idle model, or waits
  for a busy one to finish and then unloads it.

## How xBot enforces local-only

- **Endpoint.** Only `http://127.0.0.1:<port>`, `http://localhost:<port>` or
  `http://[::1]:<port>` are accepted, with an explicit port and nothing else
  (`src/shared/aiEndpoint.ts`).
  - Requests to `localhost` go to `127.0.0.1`, so no DNS lookup or hosts-file
    entry is involved.
  - Every request is re-checked, uses `redirect:'manual'`, and treats any 3xx
    as an error.
  - The renderer can't call Ollama: the CSP's `connect-src` allows only
    `'self'` and `xbot-media:` (plus the Vite websocket in dev).
- **Proxies.** If xBot's process is told to use a proxy
  (`NODE_USE_ENV_PROXY` or `--use-env-proxy`, plus `HTTP_PROXY`) and
  `NO_PROXY` doesn't cover the loopback host, xBot refuses to send AI
  requests.
- **Locality.** A model is used only if all of these hold:
  - neither `/api/tags` nor `/api/show` reports `remote_host` or
    `remote_model`;
  - its name isn't cloud-sourced. This mirrors Ollama's own rule
    (`internal/modelref.parseSourceSuffix`): the part after the last `:`,
    trimmed and lowercased, is neither `cloud` nor ends in `-cloud`.
    Examples: `gemma4:cloud`, `gemma4:31b-cloud`, `gpt-oss:120b-cloud`;
  - `/api/show` succeeds and lists `capabilities` including `completion`;
  - its size is at least 50 MB. A cloud stub is a few hundred bytes.

  Anything xBot can't establish counts as "can't verify", and xBot doesn't
  generate with it.
- **Memory hygiene.** `/api/ps` is read once per action, and the selected
  model is matched by digest.
  - If xBot loaded the model, it sends `keep_alive:"5m"`. In low-resource
    mode it sends `0` (unload right after) and `num_ctx` 2048 instead of 4096.
  - If other work already had the model loaded, xBot keeps that work's
    remaining keep-alive (never shorter, never ≤ 0) and its `context_length`,
    so the model isn't unloaded early or reloaded.
  - xBot doesn't load a model when 3 or more other models are loaded, or when
    the loaded models plus this one would take more than 75% of RAM. Either
    could make Ollama unload someone else's model.
- **One generation at a time.** User actions go ahead of background work
  (project suggestions) and pre-empt it.

## Known limits

- A loopback port forwarded to another machine (for example
  `ssh -L 11434:remote:11434`) looks local to xBot. Run Ollama itself on this
  Mac.
- An older Ollama that doesn't report `capabilities` makes every model "can't
  verify". Update Ollama.
- The 50 MB cloud-stub size, the 75% memory rule and the 3-bytes-per-token
  input budget are heuristics.
- `needsReload` also compares runner options that `/api/ps` doesn't report
  (`num_batch`, `num_gpu`, `use_mmap`, `num_thread`, and the model's `shift`
  default). A model another app loaded with custom runner options may still
  reload when xBot uses it.
- If the composer reloads while a generation runs, that run's result is
  dropped. The "Running locally · Cancel" row still comes back.

## Troubleshooting

| Status | What to do |
|---|---|
| **Ollama not running** | Open Ollama, or install it from ollama.com. Then press **Check again**. If you changed the port, set the same endpoint in Settings → Local AI. |
| **Model needed** | Choose an installed local model, or download one of the suggestions. |
| "runs in the cloud" | The model is a cloud model (`…:cloud`, `…-cloud`, or Ollama reports a remote host). Choose a local one. |
| "can't confirm … runs on this Mac" | Update Ollama so it reports model details, or choose another model. |
| "took too long" | Ollama may be busy with another app, or the model is too big for this Mac. Try again, pick a smaller model, or turn on low-resource mode. |
| "too much text" | Shorten the draft or note, or turn off low-resource mode. |
| Download stopped | Usually the disk is full or the network dropped. Free some space, then **Retry**; Ollama resumes partial downloads. |

xBot's main-process log is at `~/Library/Application Support/xBot/logs/main.log`
(`xBot Dev` for `pnpm dev`). Ollama's own log is at `~/.ollama/logs/server.log`.
