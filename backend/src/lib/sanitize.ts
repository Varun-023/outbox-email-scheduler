import { convert } from 'html-to-text';
import sanitizeHtml from 'sanitize-html';

const PREVIEW_LENGTH = 200;

/** Allowlist matching what the compose editor can produce; everything else is dropped. */
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'div',
    'span',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'strike',
    'ul',
    'ol',
    'li',
    'blockquote',
    'h1',
    'h2',
    'h3',
    'a',
  ],
  allowedAttributes: {
    a: ['href', 'target', 'rel'],
    '*': ['style'],
  },
  allowedStyles: {
    '*': {
      'text-align': [/^(left|right|center|justify)$/],
      'font-size': [/^\d{1,2}(\.\d{1,2})?(px|em|rem|%)$/],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
  },
};

export interface PreparedBody {
  html: string;
  text: string;
  preview: string;
}

/** Cleans untrusted HTML and derives the plain-text part and the one-line list preview. */
export function prepareEmailBody(untrustedHtml: string): PreparedBody {
  const html = sanitizeHtml(untrustedHtml, SANITIZE_OPTIONS);
  const text = convert(html, {
    wordwrap: false,
    selectors: [{ selector: 'a', options: { hideLinkHrefIfSameAsText: true } }],
  }).trim();
  const preview = text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_LENGTH);
  return { html, text, preview };
}
