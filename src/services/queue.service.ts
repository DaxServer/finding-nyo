import { StopService } from './stop.service'

export class QueueService {
  static async generate(lat: number, lng: number, radius_m: number, min_tram_m = 0) {
    return StopService.findNearby(lat, lng, radius_m, min_tram_m)
  }
}
