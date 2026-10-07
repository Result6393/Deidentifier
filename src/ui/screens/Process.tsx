import { useState } from 'preact/hooks';
import { session } from '../../state/session';
import { TypeStep } from './Type';
import { StraightenStep } from './Straighten';
import { RedactStep } from './Redact';
import { ReviewStep } from './Review';

type Step = 'type' | 'straighten' | 'redact' | 'review';
const STEPS: { id: Step; label: string }[] = [
  { id: 'type', label: 'Type' },
  { id: 'straighten', label: 'Straighten' },
  { id: 'redact', label: 'Redact' },
  { id: 'review', label: 'Review & export' },
];

interface Props {
  id: string;
  onExit: () => void;
  onOpen: (id: string) => void;
}

export function ProcessScreen({ id, onExit, onOpen }: Props) {
  const img = session.images.find((i) => i.id === id);
  const [step, setStep] = useState<Step>(img?.flat ? 'redact' : img?.type ? 'straighten' : 'type');
  if (!img) {
    return (
      <div class="card stack">
        <p>This image is no longer in the session.</p>
        <button class="btn" onClick={onExit}>
          Back to photos
        </button>
      </div>
    );
  }
  const reachable = (s: Step) => s === 'type' || (s === 'straighten' && !!img.type) || ((s === 'redact' || s === 'review') && !!img.flat);
  const index = session.images.indexOf(img);
  const nextImage = session.images.slice(index + 1).find((i) => !i.exported) ?? session.images.find((i) => !i.exported && i !== img);

  return (
    <div class="stack">
      <nav class="steps">
        <button class="link" onClick={onExit}>
          ← Photos
        </button>
        {STEPS.map((s) => (
          <button key={s.id} class={`step ${step === s.id ? 'current' : ''}`} disabled={!reachable(s.id) || s.id === 'review'} onClick={() => setStep(s.id)}>
            {s.label}
          </button>
        ))}
      </nav>
      {step === 'type' && <TypeStep img={img} onNext={() => setStep('straighten')} />}
      {step === 'straighten' && <StraightenStep img={img} onNext={() => setStep('redact')} />}
      {step === 'redact' && <RedactStep img={img} onNext={() => setStep('review')} />}
      {step === 'review' && (
        <ReviewStep img={img} onBack={() => setStep('redact')} onDone={onExit} onNextImage={nextImage ? () => onOpen(nextImage.id) : undefined} />
      )}
    </div>
  );
}
