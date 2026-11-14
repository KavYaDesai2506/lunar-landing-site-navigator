const TEAM: [string, string][] = [
  ["Kavya Desai", "kavyadesai2506@gmail.com"],
  ["Shubh Lineswala", "shubhlineswala@gmail.com"],
];

export default function AboutView() {
  return (
    <section className="about" aria-labelledby="about-h">
      <h1 id="about-h">About us</h1>
      <ul className="about-list">
        {TEAM.map(([name, mail]) => (
          <li key={mail} className="card about-card">
            <span className="about-name">{name}</span>
            <a href={`mailto:${mail}`}>{mail}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}
