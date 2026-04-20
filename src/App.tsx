import { useEffect } from 'react';
import { appTemplate } from './template';
import { useLegacyApp } from './hooks/useLegacyApp';
import { getMissingFirebaseEnvVars } from './firebase';

export default function App() {
  const initialize = useLegacyApp();
  const missingEnvVars = getMissingFirebaseEnvVars();

  useEffect(() => {
    if (missingEnvVars.length > 0) {
      return;
    }
    initialize();
  }, [initialize, missingEnvVars]);

  if (missingEnvVars.length > 0) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'Inter, sans-serif', background: '#0f172a', color: 'white', padding: '24px' }}>
        <div style={{ maxWidth: '720px', width: '100%', background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px', padding: '24px' }}>
          <h1 style={{ marginTop: 0 }}>Firebase config missing</h1>
          <p>Create a local <code>.env</code> file from <code>.env.example</code> and add these keys:</p>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#020617', padding: '16px', borderRadius: '12px', overflow: 'auto' }}>
            {missingEnvVars.join('\n')}
          </pre>
        </div>
      </div>
    );
  }

  return <div dangerouslySetInnerHTML={{ __html: appTemplate }} />;
}
