// ============================================
// src/utils/distanceService.js
// TRUCK-SPECIFIC DISTANCE CALCULATION
// ============================================

// ============================================
// TRUCK CONFIGURATION - CUSTOMIZE FOR YOUR FLEET
// ============================================
const TRUCK_CONFIG = {
  // Standard 53ft Trailer
  height: 4.1,        // meters (13.5 ft)
  width: 2.6,         // meters (8.5 ft)  
  length: 16.2,       // meters (53 ft)
  weight: 40,         // metric tons (80,000 lbs)
  axleLoad: 10,       // metric tons
  hazmat: false,      // Set true if carrying hazardous materials
  
  // Customize for drayage/local moves
  highwayBias: 0.3,   // Lower = more local roads (better for drayage)
  avoidTolls: false,  // Set true to avoid toll roads
};

// ============================================
// CACHE - Store calculated routes
// ============================================
let routeCache = {};

// ============================================
// MAIN DISTANCE CALCULATION
// ============================================
export const calculateTruckDistance = async (from, to, truckConfig = {}) => {
  if (!from || !to) {
    console.warn('Missing address data');
    return null;
  }

  // Clean addresses
  const fromClean = from.trim();
  const toClean = to.trim();
  
  // Check cache first
  const cacheKey = `${fromClean.toLowerCase()}_${toClean.toLowerCase()}`;
  if (routeCache[cacheKey]) {
    console.log('📦 Route found in cache');
    return { ...routeCache[cacheKey], source: 'Cache' };
  }

  const config = { ...TRUCK_CONFIG, ...truckConfig };
  
  try {
    // ✅ FIXED: Use Vite's environment variable (NOT process.env)
    const apiKey = import.meta.env.VITE_GRAPHOPPER_API_KEY || '';
    
    // ✅ If no API key, use fallback immediately
    if (!apiKey) {
      console.warn('⚠️ No GraphHopper API key found. Using fallback distance.');
      return await getFallbackDistance(from, to);
    }
    
    // Build the API URL with truck parameters
    const baseUrl = 'https://graphhopper.com/api/1/route';
    const params = new URLSearchParams({
      point: [fromClean, toClean],
      vehicle: 'truck',
      locale: 'en',
      instructions: 'false',
      points_encoded: 'false',
      'truck_height': config.height,
      'truck_width': config.width,
      'truck_length': config.length,
      'truck_weight': config.weight,
      'truck_axle_load': config.axleLoad,
      weighting: 'fastest',
      key: apiKey,  // ✅ Now using the API key from .env
    });

    // Add truck-specific constraints
    if (config.hazmat) {
      params.append('truck_hazmat', 'yes');
    }
    if (config.avoidTolls) {
      params.append('avoid', 'toll');
    }

    const url = `${baseUrl}?${params.toString()}`;
    
    console.log('📍 Fetching truck route...');
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.paths && data.paths.length > 0) {
      const path = data.paths[0];
      const distanceKm = path.distance / 1000;
      const timeMinutes = Math.round(path.time / 60000);
      const timeHours = (path.time / 3600000).toFixed(1);
      
      // Calculate fuel estimate
      const fuelEstimate = calculateFuelEstimate(distanceKm, config);
      
      // Extract road type breakdown
      const roadBreakdown = extractRoadBreakdown(path);
      
      const routeData = {
        distanceKm: parseFloat(distanceKm.toFixed(1)),
        distanceMiles: parseFloat((distanceKm * 0.621371).toFixed(1)),
        timeMinutes: timeMinutes,
        timeHours: parseFloat(timeHours),
        fuelEstimate: fuelEstimate,
        roadBreakdown: roadBreakdown,
        source: 'GraphHopper Truck Routing',
        timestamp: new Date().toISOString(),
        from: fromClean,
        to: toClean,
      };
      
      // Save to cache
      routeCache[cacheKey] = routeData;
      
      console.log(`✅ Route calculated: ${routeData.distanceKm} km (${routeData.source})`);
      return routeData;
    }
    
    // Fallback if API fails
    console.warn('GraphHopper API failed, using fallback');
    return await getFallbackDistance(from, to);
    
  } catch (error) {
    console.error('Truck routing error:', error);
    return await getFallbackDistance(from, to);
  }
};

// ============================================
// FUEL ESTIMATION
// ============================================
const calculateFuelEstimate = (distanceKm, config) => {
  // Fuel efficiency based on truck type
  // For drayage/local: ~2-4 km/L (better on highways)
  let efficiency = 3.0; // Default: 3 km/L
  
  // Adjust for truck weight
  if (config.weight > 35) efficiency *= 0.8;
  if (config.weight > 40) efficiency *= 0.7;
  
  // Adjust for highway vs local
  const highwayRatio = config.highwayBias || 0.3;
  // Local roads = lower efficiency, highways = higher efficiency
  const adjustedEfficiency = efficiency * (0.8 + highwayRatio * 0.4);
  
  const liters = distanceKm / adjustedEfficiency;
  
  return {
    liters: parseFloat(liters.toFixed(1)),
    gallons: parseFloat((liters / 3.785).toFixed(1)),
    efficiencyKmPerL: parseFloat(adjustedEfficiency.toFixed(2)),
    efficiencyMpg: parseFloat((adjustedEfficiency * 2.352).toFixed(1)),
  };
};

// ============================================
// ROAD TYPE BREAKDOWN
// ============================================
const extractRoadBreakdown = (path) => {
  const breakdown = {
    highway: 0,
    mainRoad: 0,
    localRoad: 0,
    unknown: 0,
  };
  
  if (path.instructions) {
    path.instructions.forEach(instruction => {
      const distance = instruction.distance || 0;
      const roadType = instruction.street_name || '';
      
      if (roadType.includes('motorway') || roadType.includes('highway')) {
        breakdown.highway += distance;
      } else if (roadType.includes('primary') || roadType.includes('secondary')) {
        breakdown.mainRoad += distance;
      } else if (roadType.includes('residential') || roadType.includes('street')) {
        breakdown.localRoad += distance;
      } else {
        breakdown.unknown += distance;
      }
    });
  }
  
  // Convert to km
  return {
    highway: parseFloat((breakdown.highway / 1000).toFixed(1)),
    mainRoad: parseFloat((breakdown.mainRoad / 1000).toFixed(1)),
    localRoad: parseFloat((breakdown.localRoad / 1000).toFixed(1)),
    unknown: parseFloat((breakdown.unknown / 1000).toFixed(1)),
  };
};

// ============================================
// FALLBACK DISTANCE (When API fails)
// ============================================
const getFallbackDistance = async (from, to) => {
  // Check localStorage for saved routes
  const savedRoutes = JSON.parse(localStorage.getItem('savedTruckRoutes') || '{}');
  const fromClean = from.trim().toLowerCase();
  const toClean = to.trim().toLowerCase();
  const key = `${fromClean}_${toClean}`;
  
  if (savedRoutes[key]) {
    console.log('📦 Using saved route from localStorage');
    return { ...savedRoutes[key], source: 'Saved Route (Fallback)' };
  }
  
  // Check reverse
  const reverseKey = `${toClean}_${fromClean}`;
  if (savedRoutes[reverseKey]) {
    return { ...savedRoutes[reverseKey], source: 'Saved Route (Fallback)' };
  }
  
  // Last resort: Try Google Maps as fallback (car routing)
  try {
    const googleApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';
    if (googleApiKey) {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(from)}&destinations=${encodeURIComponent(to)}&key=${googleApiKey}`
      );
      const data = await response.json();
      if (data.rows?.[0]?.elements?.[0]?.status === 'OK') {
        const distanceKm = data.rows[0].elements[0].distance.value / 1000;
        // Add 15% for truck routing (trucks take longer routes)
        const truckDistance = distanceKm * 1.15;
        return {
          distanceKm: parseFloat(truckDistance.toFixed(1)),
          distanceMiles: parseFloat((truckDistance * 0.621371).toFixed(1)),
          timeMinutes: Math.round(data.rows[0].elements[0].duration.value / 60),
          source: 'Google Maps (Car + 15% adjustment)',
          isEstimated: true,
        };
      }
    }
  } catch (e) {
    console.log('Google Maps fallback failed');
  }
  
  // If all else fails, return null
  console.warn('⚠️ All distance calculation methods failed');
  return null;
};

// ============================================
// SAVE ROUTE TO CACHE
// ============================================
export const saveRouteToCache = (from, to, routeData) => {
  const fromClean = from.trim().toLowerCase();
  const toClean = to.trim().toLowerCase();
  const key = `${fromClean}_${toClean}`;
  
  // Save to in-memory cache
  routeCache[key] = routeData;
  
  // Also save to localStorage for persistence
  try {
    const savedRoutes = JSON.parse(localStorage.getItem('savedTruckRoutes') || '{}');
    savedRoutes[key] = routeData;
    localStorage.setItem('savedTruckRoutes', JSON.stringify(savedRoutes));
  } catch (error) {
    console.warn('Failed to save route to localStorage:', error);
  }
};

// ============================================
// BATCH CALCULATE FOR MULTIPLE LEGS
// ============================================
export const calculateBatchDistances = async (legs) => {
  const results = [];
  
  for (const leg of legs) {
    if (leg.from && leg.to) {
      const routeData = await calculateTruckDistance(leg.from, leg.to);
      if (routeData) {
        results.push({
          legId: leg.id,
          ...routeData,
        });
      }
    }
  }
  
  return results;
};

// ============================================
// CLEAR CACHE (For testing)
// ============================================
export const clearDistanceCache = () => {
  routeCache = {};
  localStorage.removeItem('savedTruckRoutes');
  console.log('🗑️ Distance cache cleared');
};

// ============================================
// GET CACHE STATISTICS
// ============================================
export const getCacheStats = () => {
  const savedRoutes = JSON.parse(localStorage.getItem('savedTruckRoutes') || '{}');
  return {
    cachedCount: Object.keys(routeCache).length,
    savedCount: Object.keys(savedRoutes).length,
    totalRoutes: Object.keys({ ...routeCache, ...savedRoutes }).length,
  };
};