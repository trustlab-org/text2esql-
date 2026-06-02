/*
 * Raw-Monaco controlled KQL editor.
 *
 * Language note: this Kibana version registers no `kuery`/KQL Monaco language,
 * so `resolveKqlLanguageId()` falls back to `'plaintext'`. It auto-upgrades to
 * `'kuery'` if a future version registers that language. The Monaco built-in
 * theme `'vs-dark'` gives the always-dark code area shown in the mockup.
 *
 * `@kbn/monaco` is imported for the `monaco` instance; importing it also runs
 * its `register_globals` side effect (sets up MonacoEnvironment) so raw
 * `monaco.editor.create(...)` works.
 */
import React, { useEffect, useRef } from 'react';
import { monaco } from '@kbn/monaco';

export interface KQLEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  height?: number /* default 200 */;
}

/**
 * Resolves the Monaco language id for the editor. Prefers a registered `kuery`
 * language if one ever exists; otherwise falls back to `plaintext`.
 */
function resolveKqlLanguageId(): string {
  return monaco.languages.getLanguages().some((l) => l.id === 'kuery') ? 'kuery' : 'plaintext';
}

export const KQLEditor: React.FC<KQLEditorProps> = ({ value, onChange, readOnly, height }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  // Keep the latest onChange in a ref so the once-only create effect always
  // calls the current handler without re-creating the editor.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Create the editor once on mount; dispose it (and the change subscription)
  // on unmount.
  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const editor = monaco.editor.create(containerRef.current, {
      value,
      language: resolveKqlLanguageId(),
      theme: 'vs-dark',
      readOnly,
      automaticLayout: true,
      minimap: { enabled: false },
      lineNumbers: 'off',
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      fontSize: 13,
      padding: { top: 12, bottom: 12 },
      renderLineHighlight: 'none',
      overviewRulerLanes: 0,
      scrollbar: { alwaysConsumeMouseWheel: false },
      fontFamily: "'Roboto Mono', Menlo, Monaco, monospace",
    });
    editorRef.current = editor;

    const subscription = editor.onDidChangeModelContent(() => {
      onChangeRef.current(editor.getValue());
    });

    return () => {
      subscription.dispose();
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Controlled value sync: only push external value changes, never echo a
  // self-originated edit (prevents cursor-jump / update loops).
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.getValue() !== value) {
      editor.setValue(value);
    }
  }, [value]);

  // ReadOnly sync.
  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly });
  }, [readOnly]);

  return (
    <div
      data-test-subj="queryCopilotKqlEditor"
      ref={containerRef}
      css={{ height: height ?? 200, width: '100%' }}
    />
  );
};
