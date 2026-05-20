// Small mic toggle that wraps `useVoiceInput`. Drops into either the
// home composer or the project chat composer — both pass a callback
// that appends committed transcripts to the draft, plus an optional
// interim callback to show a ghost preview while the user is still
// speaking. The button itself is purely presentational; recognition
// state lives in the hook.

import { useEffect } from 'react';
import { Icon } from './Icon';
import { useVoiceInput } from '../hooks/useVoiceInput';

interface Props {
  // Called with each committed (final) utterance chunk. The host
  // typically appends ` ${text}` to its draft state.
  onCommit: (text: string) => void;
  // Called with the latest interim transcript so the host can render
  // a ghost overlay. Passing nothing is fine — the committed text
  // alone is the primary surface.
  onInterim?: (text: string) => void;
  // Optional BCP-47 language tag override. Defaults to navigator.language.
  lang?: string;
  className?: string;
  title?: string;
}

export function MicButton({
  onCommit,
  onInterim,
  lang,
  className,
  title,
}: Props) {
  const voice = useVoiceInput({ onCommit, onInterim, lang });

  // Stop recognition if the button unmounts mid-utterance so the
  // browser doesn't keep the mic open after the composer closes.
  useEffect(() => {
    return () => {
      voice.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!voice.available) {
    // Render a disabled stub so layout stays predictable. Most modern
    // Chromium-based shells support webkitSpeechRecognition; this
    // branch protects Safari + Firefox.
    return null;
  }

  const listening = voice.status === 'listening' || voice.status === 'starting';
  const label = listening ? 'Stop voice input' : 'Start voice input';

  return (
    <button
      type="button"
      className={`mic-btn${listening ? ' mic-btn-active' : ''}${
        voice.status === 'error' ? ' mic-btn-error' : ''
      }${className ? ` ${className}` : ''}`}
      data-testid="mic-button"
      aria-label={label}
      aria-pressed={listening}
      title={
        title ?? (voice.errorMessage && voice.status === 'error'
          ? `Voice input error: ${voice.errorMessage}`
          : label)
      }
      onClick={voice.toggle}
    >
      <Icon name="mic" size={14} />
      {listening ? <span className="mic-btn-pulse" aria-hidden /> : null}
    </button>
  );
}
