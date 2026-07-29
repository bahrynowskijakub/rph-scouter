import { Link } from 'react-router-dom';
import { InkSlot } from '@/shared/Ink';

export default function NotFoundPage() {
  return (
    <div className="container nf">
      {/* The same empty socket an unscouted player gets — nothing filed here either. */}
      <div className="nf-mark">
        <InkSlot size="xl" />
      </div>
      <p className="nf-code">404</p>
      <p className="nf-text">Nie ma tu nic do zescoutowania.</p>
      <Link to="/" className="btn" style={{ textDecoration: 'none' }}>
        Wróć do listy graczy
      </Link>
    </div>
  );
}
