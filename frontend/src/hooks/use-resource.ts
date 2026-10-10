import { useCallback, useEffect, useState } from 'react';

import { ApiError, toApiError } from '@/lib/api';

/**
 * Load data from the API with loading / error / refresh state.
 * `fetcher` must be stable (a module-level function or wrapped in useCallback).
 */
export function useResource<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const run = useCallback(
    (isActive: () => boolean = () => true) =>
      fetcher().then(
        (result) => {
          if (!isActive()) return;
          setData(result);
          setError(null);
          setLoading(false);
          setRefreshing(false);
        },
        (e) => {
          if (!isActive()) return;
          setError(toApiError(e));
          setLoading(false);
          setRefreshing(false);
        },
      ),
    [fetcher],
  );

  useEffect(() => {
    let active = true;
    run(() => active);
    return () => {
      active = false;
    };
  }, [run]);

  return {
    data,
    error,
    loading,
    refreshing,
    /** Pull-to-refresh: shows the spinner. */
    refresh: useCallback(() => {
      setRefreshing(true);
      run();
    }, [run]),
    /** Background reload after a change (no spinner). */
    reload: useCallback(() => {
      run();
    }, [run]),
  };
}
