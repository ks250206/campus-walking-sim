import { useEffect, useRef, useState } from 'react';
import { Simulator } from './sim/engine';
import { loadCampusData } from './sim/loadData';
import { settingsStore } from './sim/settings';

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('読み込み中');

  useEffect(() => {
    let sim: Simulator | null = null;
    let cancelled = false;
    void (async () => {
      try {
        const data = await loadCampusData(setStatus);
        if (cancelled || !hostRef.current) return;
        sim = await Simulator.create(hostRef.current, data, settingsStore.get(), (label) => setStatus(label));
        (window as unknown as { __sim: Simulator }).__sim = sim;
        setStatus('ready');
      } catch (err) {
        console.error(err);
        setStatus(`error: ${String(err)}`);
      }
    })();
    return () => {
      cancelled = true;
      sim?.destroy();
    };
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="absolute inset-0" />
      <div id="status" className="absolute left-2 top-2 rounded bg-black/50 px-2 py-1 text-xs">
        {status}
      </div>
    </div>
  );
}
