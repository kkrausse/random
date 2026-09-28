# Route search invariant

The car, motorcycle, and bicycle sliders are ranking preferences, never filters.
For the same region, start, distance range, activity, shape, and seed, changing
any slider from −5 through +5 must preserve the exact candidate/result route
membership (IDs and geometry); only scores and ordering may change. Generate a
bounded, deterministic pool with fixed discovery profiles independent of user
preferences, and perform deduplication, distance filtering, diversity selection,
and result caps before preference scoring. Keep physical distance, activity
access restrictions, barriers, and topology as hard constraints. All-zero means
no vehicle/road bias in ranking; the visible default car avoidance must be
represented by the shared `DEFAULT_SEARCH_PREFERENCES` constant in the UI.
