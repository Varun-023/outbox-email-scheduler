import { describe, expect, it } from 'vitest';
import { prepareEmailBody } from '../../../src/lib/sanitize';

describe('prepareEmailBody', () => {
  it('keeps editor formatting', () => {
    const { html } = prepareEmailBody(
      '<p style="text-align: center">Hi <strong>Oliver</strong>, <em>quick</em> <u>note</u></p>' +
        '<ul><li>One</li></ul><blockquote>Quote</blockquote>',
    );

    expect(html).toBe(
      '<p style="text-align:center">Hi <strong>Oliver</strong>, <em>quick</em> <u>note</u></p>' +
        '<ul><li>One</li></ul><blockquote>Quote</blockquote>',
    );
  });

  it('removes scripts, event handlers and dangerous URLs', () => {
    const { html } = prepareEmailBody(
      '<p onclick="steal()">Hello<script>alert(1)</script></p>' +
        '<a href="javascript:alert(1)">bad</a><img src=x onerror=alert(1)>' +
        '<p style="position: fixed; font-size: 14px">styled</p>',
    );

    expect(html).not.toMatch(/script|onclick|onerror|javascript:|<img|position/i);
    expect(html).toContain('<a target="_blank" rel="noopener noreferrer">bad</a>');
    expect(html).toContain('<p style="font-size:14px">styled</p>');
  });

  it('adds safe link attributes to allowed links', () => {
    const { html } = prepareEmailBody('<a href="https://example.com">site</a>');

    expect(html).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">site</a>',
    );
  });

  it('derives a plain-text body and a single-line preview', () => {
    const { text, preview } = prepareEmailBody(
      '<p>Hi John,</p><p>just wanted to follow up on our meeting.</p>',
    );

    expect(text).toBe('Hi John,\n\njust wanted to follow up on our meeting.');
    expect(preview).toBe('Hi John, just wanted to follow up on our meeting.');
  });

  it('caps the preview at 200 characters', () => {
    expect(prepareEmailBody(`<p>${'word '.repeat(100)}</p>`).preview).toHaveLength(200);
  });

  it('yields empty text for markup without content', () => {
    expect(prepareEmailBody('<script>alert(1)</script><p> </p>').text).toBe('');
  });
});
