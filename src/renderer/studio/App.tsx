import { useEscapeToHide } from '../common/useEscapeToHide';

// Placeholder Media Studio. T4/T5 (XBOT-1N58PP, XBOT-G66JJK) build the real one.

async function backToPost() {
  await window.xbot.windows.hide();
  await window.xbot.windows.showComposer();
}

export function App() {
  useEscapeToHide();

  return (
    <main className="studio">
      <header className="studio-bar">
        <button type="button" onClick={() => void backToPost()}>
          ‹ Back to post
        </button>
        <h1>Media Studio</h1>
        <button type="button" className="primary" disabled>
          Add to post
        </button>
      </header>
      <section className="studio-canvas">
        <p>The editing canvas arrives with the Studio tickets.</p>
      </section>
    </main>
  );
}
