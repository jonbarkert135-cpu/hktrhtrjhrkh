import { useParams } from 'react-router-dom';

export default function ProjectPage() {
  const { projectId } = useParams();
  return (
    <section className="nx-stack nx-auth-card">
      <h2>Project</h2>
      <p className="nx-muted">
        Boards, runs and members of {projectId ?? 'this project'} appear here. Boards arrive with
        the canvas engine.
      </p>
    </section>
  );
}
