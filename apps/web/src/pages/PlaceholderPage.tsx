export function ComingSoonPage({ title, phase }: { title: string; phase: string }) {
  return (
    <main className="coming">
      <p className="eyebrow">{phase}</p>
      <h2>{title}</h2>
      <p>This section is not implemented yet.</p>
    </main>
  );
}
