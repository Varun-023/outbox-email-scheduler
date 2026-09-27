import React, { useEffect, useRef } from 'react';

interface RichEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  error?: string;
}

export function RichEditor({
  value,
  onChange,
  placeholder = 'Type Your Reply...',
  error,
}: RichEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);

  // Sync value into contentEditable when it differs (initial mount or reset)
  useEffect(() => {
    if (editorRef.current && editorRef.current.innerHTML !== value) {
      if (!value && editorRef.current.innerHTML === '<br>') return;
      editorRef.current.innerHTML = value;
    }
  }, [value]);

  const handleInput = () => {
    if (editorRef.current) {
      const html = editorRef.current.innerHTML;
      onChange(html === '<br>' || html === '<div><br></div>' ? '' : html);
    }
  };

  const exec = (command: string, value: string | undefined = undefined) => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      editorRef.current.focus();
      handleInput();
    }
  };

  const insertCallout = () => {
    const calloutHtml = `<blockquote><p>⚡ <strong>Important Highlight</strong> ⚡</p><p>Add your callout text here...</p></blockquote><p><br></p>`;
    exec('insertHTML', calloutHtml);
  };

  return (
    <div className="flex-1 flex flex-col min-h-[360px] bg-[var(--color-surface-subtle)] rounded-xl border border-line p-4">
      {/* Floating Rich Text Toolbar */}
      <div className="mb-4 flex items-center justify-start">
        <div className="inline-flex items-center gap-1.5 sm:gap-2 px-4 py-1.5 bg-white border border-line rounded-full shadow-xs text-ink-muted text-xs select-none flex-wrap">
          {/* Undo / Redo */}
          <button
            type="button"
            onClick={() => exec('undo')}
            className="p-1.5 hover:text-ink hover:bg-gray-100 rounded cursor-pointer"
            title="Undo"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 10h10a5 5 0 015 5v2m-15-7l4-4m-4 4l4 4"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => exec('redo')}
            className="p-1.5 hover:text-ink hover:bg-gray-100 rounded cursor-pointer"
            title="Redo"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 10H11a5 5 0 00-5 5v2m15-7l-4-4m4 4l-4 4"
              />
            </svg>
          </button>

          <span className="text-gray-300">|</span>

          {/* Heading */}
          <button
            type="button"
            onClick={() => exec('formatBlock', '<h2>')}
            className="p-1.5 font-bold hover:text-ink hover:bg-gray-100 rounded cursor-pointer"
            title="Heading"
          >
            Tᴛ ↕
          </button>

          <span className="text-gray-300">|</span>

          {/* Bold, Italic, Underline */}
          <button
            type="button"
            onClick={() => exec('bold')}
            className="p-1.5 font-bold hover:text-ink hover:bg-gray-100 rounded cursor-pointer text-sm"
            title="Bold"
          >
            B
          </button>
          <button
            type="button"
            onClick={() => exec('italic')}
            className="p-1.5 italic hover:text-ink hover:bg-gray-100 rounded cursor-pointer text-sm"
            title="Italic"
          >
            I
          </button>
          <button
            type="button"
            onClick={() => exec('underline')}
            className="p-1.5 underline hover:text-ink hover:bg-gray-100 rounded cursor-pointer text-sm"
            title="Underline"
          >
            U
          </button>

          <span className="text-gray-300">|</span>

          {/* Alignment */}
          <button
            type="button"
            onClick={() => exec('justifyLeft')}
            className="p-1.5 hover:text-ink hover:bg-gray-100 rounded cursor-pointer"
            title="Align Left"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h10M4 18h14" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => exec('justifyCenter')}
            className="p-1.5 hover:text-ink hover:bg-gray-100 rounded cursor-pointer"
            title="Align Center"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M7 12h10M5 18h14" />
            </svg>
          </button>

          <span className="text-gray-300">|</span>

          {/* Lists */}
          <button
            type="button"
            onClick={() => exec('insertOrderedList')}
            className="p-1.5 hover:text-ink hover:bg-gray-100 rounded cursor-pointer text-xs font-mono"
            title="Numbered List"
          >
            1.
          </button>
          <button
            type="button"
            onClick={() => exec('insertUnorderedList')}
            className="p-1.5 hover:text-ink hover:bg-gray-100 rounded cursor-pointer text-xs"
            title="Bullet List"
          >
            •
          </button>

          {/* Callout Quote */}
          <button
            type="button"
            onClick={insertCallout}
            className="p-1.5 hover:text-ink hover:bg-gray-100 rounded cursor-pointer font-serif text-sm font-bold"
            title="Insert Callout Box"
          >
            “ ”
          </button>

          {/* Strikethrough */}
          <button
            type="button"
            onClick={() => exec('strikeThrough')}
            className="p-1.5 line-through hover:text-ink hover:bg-gray-100 rounded cursor-pointer text-xs"
            title="Strikethrough"
          >
            S
          </button>
        </div>
      </div>

      {/* Editor Content Area */}
      <div
        ref={editorRef}
        contentEditable
        onInput={handleInput}
        onBlur={handleInput}
        data-placeholder={placeholder}
        className="flex-1 w-full text-sm text-ink leading-relaxed focus:outline-none min-h-[260px] empty:before:content-[attr(data-placeholder)] empty:before:text-[var(--color-ink-subtle)] empty:before:pointer-events-none prose prose-sm max-w-none [&_blockquote]:border-l-4 [&_blockquote]:border-[var(--color-callout-bar)] [&_blockquote]:bg-[var(--color-callout-bg)] [&_blockquote]:p-3 [&_blockquote]:rounded-r-lg [&_blockquote]:my-3 [&_blockquote]:font-medium"
      />

      {error && <p className="mt-2 text-xs text-red-600 font-medium">{error}</p>}
    </div>
  );
}
