// Shared, pure helpers for SSE streaming of the chat-style AI endpoints
// (/ai/ask and /ai/recipe-assistant).
//
// Both endpoints keep their existing non-streaming JSON contract intact as a
// fallback. When a client opts in with `Accept: text/event-stream`, the route
// streams the model's tokens as Server-Sent Events:
//   event: delta  → { text }   incremental answer text (one or more per stream)
//   event: done   → <final payload identical to the non-stream JSON response>
//   event: error  → { error }  a provider/parse failure; the client may fall back
//
// The model is still asked for a strict JSON object (response_format
// json_object), so the raw token stream is a growing JSON string. To surface
// readable text as it arrives we incrementally decode just the `answer` string
// field out of the partial JSON — see extractJsonStringField. Nothing here does
// I/O; this module is unit-tested in isolation.

// Does the request opt into SSE streaming? We key off the standard Accept header
// so the request body (and its Zod validation) is completely unchanged.
export function wantsEventStream(accept: string | string[] | undefined): boolean {
  if (!accept) return false;
  const value = Array.isArray(accept) ? accept.join(",") : accept;
  return value.toLowerCase().includes("text/event-stream");
}

// Serialize one SSE frame. data is JSON-encoded on a single line (no embedded
// newlines after encoding), which is a valid single-`data:` SSE frame.
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// Incrementally decode the current value of a top-level JSON string field out of
// a (possibly truncated) JSON document. Returns the decoded text read so far —
// the field's literal need not be closed yet, so this is safe to call on every
// streamed chunk. Returns "" until the field's opening quote has been seen.
//
// Handles the standard JSON string escapes (\" \\ \/ \n \r \t \b \f and \uXXXX).
// An escape or \u sequence split across the buffer boundary stops decoding at
// that point; the next call (with more buffer) resumes correctly.
export function extractJsonStringField(raw: string, field: string): string {
  const key = `"${field}"`;
  const keyIdx = raw.indexOf(key);
  if (keyIdx === -1) return "";
  let i = keyIdx + key.length;
  // Skip whitespace, then the required colon, then whitespace.
  while (i < raw.length && /\s/.test(raw[i])) i++;
  if (raw[i] !== ":") return "";
  i++;
  while (i < raw.length && /\s/.test(raw[i])) i++;
  if (raw[i] !== '"') return "";
  i++; // step past the opening quote

  let out = "";
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "\\") {
      // Need the escaped character; if it hasn't arrived yet, stop here.
      if (i + 1 >= raw.length) break;
      const next = raw[i + 1];
      switch (next) {
        case "n":
          out += "\n";
          i += 2;
          break;
        case "t":
          out += "\t";
          i += 2;
          break;
        case "r":
          out += "\r";
          i += 2;
          break;
        case "b":
          out += "\b";
          i += 2;
          break;
        case "f":
          out += "\f";
          i += 2;
          break;
        case "/":
          out += "/";
          i += 2;
          break;
        case '"':
          out += '"';
          i += 2;
          break;
        case "\\":
          out += "\\";
          i += 2;
          break;
        case "u": {
          // Need all four hex digits; if not yet buffered, stop and resume later.
          if (i + 6 > raw.length) return out;
          const hex = raw.slice(i + 2, i + 6);
          if (/^[0-9a-fA-F]{4}$/.test(hex)) {
            out += String.fromCharCode(parseInt(hex, 16));
            i += 6;
          } else {
            // Malformed unicode escape — bail rather than emit garbage.
            return out;
          }
          break;
        }
        default:
          // Unknown escape — keep the character verbatim.
          out += next;
          i += 2;
          break;
      }
    } else if (ch === '"') {
      // Unescaped closing quote — the field value is complete.
      break;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}
