// Above the canvas of a grid page: which arrangement the selected display's shape shows (ADR-0028),
// giving the shape one of its own, going back to the default, and the tiles it hides.
import { useState } from 'react';
import type { Shape, Tile } from '@esphelm/schema';
import { SHAPE_TITLES } from '../arrangements';

interface Props {
  shape: Shape;
  /** The page has an arrangement of its own for this shape. */
  own: boolean;
  hidden: Tile[];
  /** Start this shape's arrangement from the default, as it is or turned. */
  onArrange(turned: boolean): void;
  onDrop(): void;
  onShow(id: string): void;
}

export function ArrangementBar(props: Props) {
  const [step, setStep] = useState<'menu' | 'drop' | null>(null);
  const name = SHAPE_TITLES[props.shape];
  const lower = name.toLowerCase();
  return (
    <section className="arrangement" aria-label="Arrangement">
      <div className="arrangement-row">
        <span>
          <b>{name}</b>
          {props.own ? ' arrangement' : ': uses the default arrangement'}
        </span>
        {props.own ? (
          step === 'drop' ? (
            <span className="arrangement-confirm">
              Drop it?
              <button
                className="danger-inline"
                onClick={() => {
                  setStep(null);
                  props.onDrop();
                }}
              >
                Use the default
              </button>
              <button onClick={() => setStep(null)}>Keep</button>
            </span>
          ) : (
            <button onClick={() => setStep('drop')}>Use the default again</button>
          )
        ) : (
          <span className="menu-anchor">
            <button aria-expanded={step === 'menu'} onClick={() => setStep(step === 'menu' ? null : 'menu')}>
              Arrange for {lower}
            </button>
            {step === 'menu' && (
              <div className="menu" role="menu">
                <p className="hint">Only {lower} displays show it; the others keep the default.</p>
                {(
                  [
                    [false, 'Copy the default'],
                    [true, 'Copy turned (rows become columns)'],
                  ] as const
                ).map(([turned, text]) => (
                  <button
                    key={text}
                    role="menuitem"
                    onClick={() => {
                      setStep(null);
                      props.onArrange(turned);
                    }}
                  >
                    {text}
                  </button>
                ))}
              </div>
            )}
          </span>
        )}
      </div>
      {props.hidden.length > 0 && (
        <div className="arrangement-row" aria-label={`Hidden on ${lower}`}>
          <span>Hidden on {lower}:</span>
          {props.hidden.map((t) => (
            <button key={t.id} className="chip" title={`Show ${t.id} on ${lower}`} onClick={() => props.onShow(t.id)}>
              + {tileName(t)}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function tileName(t: Tile): string {
  return ('label' in t && t.label) || t.id;
}
