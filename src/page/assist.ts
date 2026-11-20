/**
 * Assist mode overlay: without a model, the challenge is put to whoever drives the browser (an AI
 * agent or a person) on the page itself. An open shadow root keeps page styles out while screenshot,
 * DOM and accessibility-tree agents can all read it; the answer box is a labeled input.
 */

export interface AssistRequest {
  instruction: string;
  /** The labeled current frame, PNG base64. */
  image: string;
  /** Answer syntax for this challenge. */
  help: string;
  /** Why the previous answer was refused. */
  error?: string;
  /** Side of the viewport away from the challenge, so the panel does not cover it. */
  side: "left" | "right";
}

export const ASSIST_HOST_ID = "llm-captcha-assist";

const STYLE = `
:host{all:initial}
.panel{position:fixed;top:16px;width:380px;max-height:calc(100vh - 32px);overflow:auto;z-index:2147483647;box-sizing:border-box;
  background:#fff;color:#1b1b1a;border:1px solid #d9d8d4;border-radius:14px;box-shadow:0 12px 40px rgb(0 0 0/.22);
  font:14px/1.45 system-ui,-apple-system,sans-serif;padding:16px}
.panel.left{left:16px}.panel.right{right:16px}
h2{font-size:15px;margin:0 0 4px}
.why{font-size:12px;color:#6b6a66;margin:0 0 10px}
.instruction{font-weight:600;margin:0 0 8px}
img{display:block;width:100%;height:auto;border-radius:8px;border:1px solid #e3e2de}
.help{font-size:12px;color:#4a4945;margin:10px 0}
.error{font-size:12px;color:#b3261e;margin:0 0 8px}
form{display:flex;gap:8px}
label{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
input{flex:1;font:14px ui-monospace,Menlo,monospace;padding:8px 10px;border:1px solid #c9c8c4;border-radius:8px;color:#1b1b1a;background:#fff}
input:focus{outline:2px solid #2f5bea55;border-color:#2f5bea}
button{font:600 14px system-ui,sans-serif;padding:8px 14px;border-radius:8px;border:0;background:#2f5bea;color:#fff;cursor:pointer}
`;

/** Show the challenge and resolve with the typed answer; the panel goes away on submit. */
export function ask(request: AssistRequest): Promise<string> {
  document.getElementById(ASSIST_HOST_ID)?.remove();
  const host = document.createElement("div");
  host.id = ASSIST_HOST_ID;
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${STYLE}</style>
<section class="panel ${request.side}" role="dialog" aria-label="Captcha: answer needed">
  <h2>Captcha: answer needed</h2>
  <p class="why">No solver model is configured, so this challenge is yours to answer: an AI agent driving this browser, or you.</p>
  <p class="instruction"></p>
  <img alt="The challenge, with clickable targets labeled by id">
  <p class="help"></p>
  <p class="error" role="alert"></p>
  <form>
    <label for="answer">Captcha answer</label>
    <input id="answer" name="answer" autocomplete="off" spellcheck="false" placeholder="e.g. t2 t5 verify" aria-label="Captcha answer">
    <button type="submit">Submit</button>
  </form>
</section>`;
  root.querySelector(".instruction")!.textContent = request.instruction || "Follow the instruction shown in the image.";
  root.querySelector("img")!.src = `data:image/png;base64,${request.image}`;
  root.querySelector(".help")!.textContent = request.help;
  const error = root.querySelector<HTMLElement>(".error")!;
  error.textContent = request.error ?? "";
  error.hidden = !request.error;
  document.documentElement.append(host);
  const input = root.querySelector("input")!;
  input.focus({ preventScroll: true });
  return new Promise((resolve) => {
    root.querySelector("form")!.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!input.value.trim()) return;
      host.remove();
      resolve(input.value);
    });
  });
}
