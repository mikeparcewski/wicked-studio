import type { RunModel } from '../hooks/useRunModel.js';

interface Props {
  model: RunModel;
}

export function DataUsed({ model }: Props): React.ReactElement {
  const withFiles = model.units.filter((u) => u.filesRead.length > 0);

  return (
    <div data-testid="data-used" className="flex flex-col gap-2 text-[11px]">
      {withFiles.length === 0 ? (
        <p style={{ color: 'rgba(230,237,243,0.4)' }} data-testid="data-used-empty">
          No files-read captured yet — populated from claude <code>tool_use</code> blocks via{' '}
          <code>dataUsed</code>.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {withFiles.map((u) => (
            <li key={u.ord} data-testid="data-used-unit" data-ord={u.ord}>
              <p className="font-semibold font-mono" style={{ color: 'rgba(230,237,243,0.7)' }}>
                unit #{u.ord}
                {u.assignedCli ? ` · ${u.assignedCli}` : ''}
              </p>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {u.filesRead.map((f) => (
                  <li key={f} className="truncate font-mono" style={{ color: 'rgba(230,237,243,0.45)' }} title={f}>
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
        className="rounded p-1.5 font-mono"
        style={{ border: '1px dashed rgba(230,237,243,0.12)', color: 'rgba(230,237,243,0.35)' }}
      >
        memory / knowledge recall: disabled (pending core-ts binding)
      </p>
    </div>
  );
}
