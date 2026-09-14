// webdeck-apple-llm — Apple's on-device language model, as a small helper the
// core spawns.
//
// Two modes:
//   --status            prints {"available":true} or {"available":false,"reason":"…"}
//   (no arguments)      reads one JSON object from stdin — {"system":…,"prompt":…,
//                       "maxTokens":…} — and streams the answer to stdout as
//                       NDJSON: {"t":"<delta>"} lines, then {"done":true}. A
//                       failure is {"error":"…"} and exit code 1.
//
// Foundation Models is macOS 26 only, so the helper is built and shipped on
// its own and the provider reports "not on this macOS" without it. Nothing
// here reaches the network: the model runs on the machine.

import Foundation
import FoundationModels

struct Request: Decodable {
  var system: String?
  var prompt: String
  var maxTokens: Int?
}

func emit(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object),
    let line = String(data: data, encoding: .utf8)
  else { return }
  FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

@available(macOS 26.0, *)
func describe(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
  switch reason {
  case .deviceNotEligible: return "This Mac does not support Apple Intelligence."
  case .appleIntelligenceNotEnabled:
    return "Apple Intelligence is off. Turn it on in System Settings → Apple Intelligence & Siri."
  case .modelNotReady: return "The model is still downloading; try again in a few minutes."
  @unknown default: return "The on-device model is not available."
  }
}

@available(macOS 26.0, *)
func status() {
  switch SystemLanguageModel.default.availability {
  case .available: emit(["available": true])
  case .unavailable(let reason): emit(["available": false, "reason": describe(reason)])
  }
}

@available(macOS 26.0, *)
func answer() async {
  let input = FileHandle.standardInput.readDataToEndOfFile()
  guard let request = try? JSONDecoder().decode(Request.self, from: input) else {
    emit(["error": "The request was not a JSON object with a prompt."])
    exit(1)
  }
  guard case .available = SystemLanguageModel.default.availability else {
    if case .unavailable(let reason) = SystemLanguageModel.default.availability {
      emit(["error": describe(reason)])
    }
    exit(1)
  }
  let session = LanguageModelSession(instructions: request.system ?? "")
  var options = GenerationOptions()
  if let max = request.maxTokens, max > 0 { options.maximumResponseTokens = max }
  var sent = ""
  do {
    let stream = session.streamResponse(to: request.prompt, options: options)
    for try await partial in stream {
      let whole = partial.content
      if whole.hasPrefix(sent) {
        let delta = String(whole.dropFirst(sent.count))
        if !delta.isEmpty { emit(["t": delta]) }
      } else {
        // The snapshot was rewritten rather than extended; send it whole and
        // let the reader replace what it has.
        emit(["replace": whole])
      }
      sent = whole
    }
    emit(["done": true])
  } catch let error as LanguageModelSession.GenerationError {
    switch error {
    case .guardrailViolation:
      emit(["error": "Apple's on-device model declined this request (its safety guardrails)."])
    case .exceededContextWindowSize:
      emit(["error": "The page is too long for Apple's on-device model (its context is small)."])
    case .unsupportedLanguageOrLocale:
      emit(["error": "Apple's on-device model does not support this language."])
    default:
      emit(["error": "Apple's on-device model failed: \(error.localizedDescription)"])
    }
    exit(1)
  } catch {
    emit(["error": "Apple's on-device model failed: \(error.localizedDescription)"])
    exit(1)
  }
}

if #available(macOS 26.0, *) {
  if CommandLine.arguments.contains("--status") {
    status()
  } else {
    let done = DispatchSemaphore(value: 0)
    Task {
      await answer()
      done.signal()
    }
    done.wait()
  }
} else {
  if CommandLine.arguments.contains("--status") {
    emit(["available": false, "reason": "Apple's on-device model needs macOS 26."])
  } else {
    emit(["error": "Apple's on-device model needs macOS 26."])
    exit(1)
  }
}
