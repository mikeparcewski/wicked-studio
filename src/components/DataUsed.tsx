import type { RunModel } from '../hooks/useRunModel.js';

interface Props {
  model: RunModel;
}

/**
 * FR-8 Data-in-use. Files each unit's CLI read, grouped by unit — sourced from real
 * `dataUsed` events (claude `tool_use` file paths). Non-claude CLIs emit no `dataUsed`, so
 * a unit with none simply shows nothing (never faked). The memory/knowledge recall row is
 * labeled **disabled (pending core-ts binding)** per NFR-3.
 */
export function DataUsed({ model }: Props): React.ReactElement {
  const withFiles = model.units.filter((u) => u.filesRead.length > 0);

  return (
    <div data-testid="data-used" className="flex flex-col gap-2 text-[11px]">
      {withFiles.length === 0 ? (
        <p className="text-gray-400" data-testid="data-used-empty">
          No files-read captured yet — populated from claude <code>tool_use</code> blocks via{' '}
          <code>dataUsed</code>.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {withFiles.map((u) => (
            <li key={u.ord} data-testid="data-used-unit" data-ord={u.ord}>
              <p className="font-semibold text-gray-600">
                unit #{u.ord}
                {u.assignedCli ? ` · ${u.assignedCli}` : ''}
              </p>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {u.filesRead.map((f) => (
                  <li key={f} className="truncate font-mono text-gray-500" title={f}>
                    {f}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <p
        data-testid="data-used-recall-disabled"
        className="rounded border border-dashed border-gray-300 bg-gray-50 p-1.5 text-gray-400"
      >
        memory / knowledge recall: disabled (pending core-ts binding)
      </p>
    </div>
  );
}
