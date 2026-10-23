/**
 * Weather quantities derived from the QUBIC surface weather station.
 *
 * This is deliberately named a proxy, not a PWV measurement: only surface
 * observations are available locally, so the vertical humidity profile has
 * to be assumed. The exponential water-vapour scale height is fixed at 2 km;
 * this makes the result useful for following relative changes, but it needs
 * calibration against a radiometer or a trusted model before being treated as
 * an absolute precipitable-water estimate.
 */
export const SURFACE_WATER_VAPOUR_SCALE_HEIGHT_M = 2_000;

const GAS_CONSTANT_WATER_VAPOUR = 461.5; // J kg⁻¹ K⁻¹
const EPSILON = 0.622; // molecular-mass ratio, water vapour / dry air

/**
 * Estimate a surface-derived PWV proxy in millimetres (kg m⁻² equivalent).
 *
 * Assumptions: the measured relative humidity represents the air at the
 * station; water-vapour mixing ratio decreases exponentially with a 2 km
 * scale height; and temperature is held at the observed surface value when
 * integrating the column. Surface pressure is used to calculate specific
 * humidity and air density. This is a transparent heuristic, not a retrieval.
 */
export function estimateSurfacePwvProxy(temperatureC, relativeHumidityPercent, pressureMbar) {
  if (![temperatureC, relativeHumidityPercent, pressureMbar].every(Number.isFinite)) return null;
  if (temperatureC <= -243.5 || pressureMbar <= 0) return null;

  const humidity = Math.min(100, Math.max(0, relativeHumidityPercent));
  const temperatureK = temperatureC + 273.15;
  if (temperatureK <= 0) return null;

  // Magnus approximation for saturation vapour pressure, in hPa (= mbar).
  const saturationVapourPressure = 6.112 * Math.exp((17.67 * temperatureC) / (temperatureC + 243.5));
  const vapourPressureMbar = (humidity / 100) * saturationVapourPressure;
  if (vapourPressureMbar <= 0) return 0;
  if (vapourPressureMbar >= pressureMbar) return null;

  const specificHumidity = (EPSILON * vapourPressureMbar) /
    (pressureMbar - (1 - EPSILON) * vapourPressureMbar);
  const dryAirGasConstant = GAS_CONSTANT_WATER_VAPOUR * EPSILON;
  const moistAirDensity = (pressureMbar * 100) / (dryAirGasConstant * temperatureK);
  const waterColumnKgPerSquareMetre = specificHumidity * moistAirDensity * SURFACE_WATER_VAPOUR_SCALE_HEIGHT_M;

  return Number.isFinite(waterColumnKgPerSquareMetre) ? waterColumnKgPerSquareMetre : null;
}
