import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EmailList } from './EmailList';

describe('EmailList', () => {
  it('renders empty state when there are no emails', () => {
    render(
      <EmailList
        emails={[]}
        folder="scheduled"
        isLoading={false}
        error={null}
        searchQuery=""
        hasMore={false}
        onLoadMore={vi.fn()}
        onSelectEmail={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText('No scheduled emails')).toBeInTheDocument();
  });

  it('renders error state with retry button', () => {
    const onRetry = vi.fn();
    render(
      <EmailList
        emails={[]}
        folder="scheduled"
        isLoading={false}
        error="Network error"
        searchQuery=""
        hasMore={false}
        onLoadMore={vi.fn()}
        onSelectEmail={vi.fn()}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('Failed to load emails')).toBeInTheDocument();
    expect(screen.getByText('Network error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/i })).toBeInTheDocument();
  });
});
