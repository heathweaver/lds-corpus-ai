import ResearchApp from "../islands/ResearchApp.tsx";

export default function Home() {
  return (
    <main class="app">
      <header class="app-header">
        <h1>LDS Corpus Research</h1>
        <p class="tagline">
          Ask a question, see which theme indexes guided retrieval, and inspect
          the sources.
        </p>
      </header>
      <ResearchApp />
    </main>
  );
}
