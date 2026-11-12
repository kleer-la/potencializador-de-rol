import { useEffect, useState } from 'react';

type ServiceStatus = 'checking' | 'ok' | 'unavailable';

const statusText: Record<ServiceStatus, string> = {
  checking: 'Verificando el servicio…',
  ok: 'Servicio disponible',
  unavailable: 'Servicio no disponible',
};

export function App() {
  const [status, setStatus] = useState<ServiceStatus>('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((response) => setStatus(response.ok ? 'ok' : 'unavailable'))
      .catch(() => setStatus('unavailable'));
  }, []);

  return (
    <main>
      <h1>Potencializador de rol</h1>
      <p role="status">{statusText[status]}</p>
    </main>
  );
}
