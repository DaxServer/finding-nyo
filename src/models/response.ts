import { t } from 'elysia'

export const StopResponse = t.Object({
  stop_id: t.Number(),
  name: t.String(),
  lat: t.Number(),
  lng: t.Number(),
  images: t.Array(t.Object({
    url: t.String(),
    distance_m: t.Number()
  }))
})

export const QueueResponse = t.Object({
  stops: t.Array(t.Number())
})

export const LocationsResponse = t.Object({
  locations: t.Array(t.Object({
    lat: t.Number(),
    lng: t.Number(),
    nearest_tram_stop_m: t.Union([t.Number(), t.Null()])
  }))
})

export const ErrorResponse = t.Object({
  error: t.String()
})

export type Stop = typeof StopResponse.static
export type Queue = typeof QueueResponse.static
export type Locations = typeof LocationsResponse.static
