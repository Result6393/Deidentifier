import { useState } from 'preact/hooks';
import { changed, parseTerms, session } from '../../state/session';

export function StartScreen({ onContinue }: { onContinue: () => void }) {
  const [patient, setPatient] = useState(session.terms.patient.join('\n'));
  const [clinician, setClinician] = useState(session.terms.clinician.join('\n'));
  const [label, setLabel] = useState(session.label);

  const go = (e: Event) => {
    e.preventDefault();
    session.terms = { patient: parseTerms(patient), clinician: parseTerms(clinician) };
    session.label = label.trim();
    changed();
    onContinue();
  };

  return (
    <form class="card stack" onSubmit={go} autocomplete="off">
      <h1>New session</h1>
      <p class="muted">
        Photos are processed <strong>only on this device</strong>. Nothing is uploaded, and nothing from the session is kept once you end it, close the app, or
        leave it idle for 10 minutes.
      </p>

      <label class="field">
        <span>Patient search terms (optional)</span>
        <textarea
          rows={3}
          value={patient}
          onInput={(e) => setPatient(e.currentTarget.value)}
          placeholder="Surname, given names, MRN, Medicare no., phone, street. One per line or comma-separated."
          spellcheck={false}
          autocapitalize="off"
          autocorrect="off"
        />
        <small class="muted">The text scan will find these anywhere in the image, e.g. a name in a letter body. Kept in memory only.</small>
      </label>

      <label class="field">
        <span>Clinician names to remove (optional)</span>
        <textarea
          rows={2}
          value={clinician}
          onInput={(e) => setClinician(e.currentTarget.value)}
          placeholder="e.g. Smith, Nguyen"
          spellcheck={false}
          autocapitalize="off"
          autocorrect="off"
        />
      </label>

      <label class="field">
        <span>Age / sex label (optional)</span>
        <input value={label} onInput={(e) => setLabel(e.currentTarget.value)} placeholder="e.g. 67M" maxLength={12} spellcheck={false} autocorrect="off" />
        <small class="muted">Can be printed on top of a covered DOB.</small>
      </label>

      <button class="btn primary big" type="submit">
        Continue
      </button>
    </form>
  );
}
