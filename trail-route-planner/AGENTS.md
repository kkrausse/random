# Keith's headline route-search requirement

Vehicle/road preferences ONLY rank routes; they NEVER exclude roads or routes,
even when EVERY available route uses car roads. No hard road/access blockage:
OSM foot/bicycle/access restrictions, private roads, barriers, and ordinary
vehicle oneway tags are evidence for inspection, not traversal filters. This
prototype does not verify legal access or safety. Zero on all three sliders is
neutral, and the visible initial UI and URL defaults must use the shared
`DEFAULT_SEARCH_PREFERENCES` constant (all zero), never a hidden −5 car bias.

The car, motorcycle, and bicycle sliders are ranking preferences, never filters.
For the same region, start, distance range, activity, shape, and seed, changing
any slider from −5 through +5 must preserve the exact candidate/result route
membership (IDs and geometry); only scores and ordering may change. Generate a
bounded, deterministic pool with fixed discovery profiles independent of user
preferences, and perform deduplication, distance filtering, diversity selection,
and result caps before preference scoring. Preserve actual graph topology,
requested distance and shape, and the physical gravel-bike steps constraint;
do not turn OSM road, vehicle, access, or barrier tags into hard exclusions.
