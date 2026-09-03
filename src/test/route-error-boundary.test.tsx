import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { captureException } = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

vi.mock('@/lib/observability', () => ({ captureException }));

import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';

function Boom(): never {
  throw new Error('orders list boom');
}

function HomeOk() {
  return <div>Home content</div>;
}

describe('RouteErrorBoundary isolation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    captureException.mockReset();
  });

  it('does not keep showing an error after navigating from Orders to Home', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <RouteErrorBoundary sectionName="Home">
              <HomeOk />
            </RouteErrorBoundary>
          ),
        },
        {
          path: '/orders',
          element: (
            <RouteErrorBoundary sectionName="Orders">
              <Boom />
            </RouteErrorBoundary>
          ),
        },
      ],
      { initialEntries: ['/orders'] },
    );

    render(<RouterProvider router={router} />);

    expect(await screen.findByText(/Error loading Orders/i)).toBeInTheDocument();

    await router.navigate('/');

    expect(await screen.findByText('Home content')).toBeInTheDocument();
    expect(screen.queryByText(/Error loading Home/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Error loading Orders/i)).not.toBeInTheDocument();
  });
});
