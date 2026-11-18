import { useState } from 'react';
import type { HudState, Simulator } from '../sim/engine';
import type { TravelDestination } from '../sim/fastTravel';
import { FullMap } from './Minimap';

export function TravelMap({
  sim,
  hud,
  touch,
  onClose,
  onTravel,
}: {
  sim: Simulator;
  hud: HudState;
  touch: boolean;
  onClose: () => void;
  onTravel: (destination: TravelDestination) => void;
}) {
  const [name, setName] = useState('');
  const destination = sim.travelDestinations.find((entry) => entry.name === name);

  return (
    <section aria-labelledby="map-title" className="absolute inset-0 flex justify-center bg-slate-950/80 p-3 sm:p-5">
      <div className="grid h-full w-full max-w-4xl grid-rows-[auto_minmax(0,1fr)_auto] gap-2 sm:gap-3">
        <header className="flex items-center justify-between gap-2">
          <div>
            <h2 id="map-title" className="text-lg font-bold">
              全体図
            </h2>
            <p className="text-xs text-white/75">赤い矢印は現在地{destination && ' ・ 青い丸は到着地点'}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 shrink-0 rounded-lg border border-white/30 bg-slate-900 px-3 text-sm font-semibold hover:bg-slate-700"
          >
            地図を閉じる{!touch && ' (M)'}
          </button>
        </header>
        <div className="flex min-h-0 min-w-0 items-center justify-center">
          <FullMap map={sim.map} hud={hud} landmarks={sim.landmarks} destination={destination} />
        </div>
        <form
          className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-2 rounded-xl border border-white/15 bg-slate-950/95 p-2.5 sm:mx-auto sm:w-full sm:max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            if (destination) onTravel(destination);
          }}
        >
          <label className="grid gap-1 text-xs text-white/80">
            行き先の建物
            <select
              className="min-h-11 w-full min-w-0 rounded-lg border border-white/25 bg-slate-800 px-2 text-base text-white"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={sim.travelDestinations.length === 0}
            >
              <option value="">{sim.travelDestinations.length ? '建物を選択' : '移動できる建物がありません'}</option>
              {sim.travelDestinations.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={!destination}
            className="min-h-11 rounded-lg bg-sky-600 px-3 text-sm font-bold hover:bg-sky-500 disabled:bg-slate-700 disabled:text-white/55"
          >
            ファストトラベル
          </button>
        </form>
      </div>
    </section>
  );
}
