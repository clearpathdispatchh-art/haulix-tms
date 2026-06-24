// src/utils/costCalculations.js

// ========== SAFE FLOAT HELPER ==========
const safeFloat = (val) => {
  if (val === null || val === undefined) return 0;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? 0 : parsed;
};

// ========== CORE CALCULATION FUNCTION ==========
export const calculateLegCost = (leg, distance = 0, hours = 0) => {
  // Early return for invalid data
  if (!leg) {
    return {
      driverWage: 0,
      fuelCost: 0,
      total: 0,
      breakdown: {
        driverWage: 0,
        fuelCost: 0,
        fuelConsumption: 0,
        calculationMethod: 'Invalid Data',
        details: { error: 'No leg data provided' }
      },
      errors: ['No leg data provided']
    };
  }

  // Handle invalid or missing driver type - fallback to manual entry
  if (!leg.driverType || leg.driverType === 'Not Set') {
    return {
      driverWage: safeFloat(leg.driverPay || 0),
      fuelCost: safeFloat(leg.fuelCost || 0),
      total: safeFloat(leg.driverPay || 0) + safeFloat(leg.fuelCost || 0),
      breakdown: {
        driverWage: safeFloat(leg.driverPay || 0),
        fuelCost: safeFloat(leg.fuelCost || 0),
        fuelConsumption: 0,
        calculationMethod: 'Manual Entry (Fallback)',
        details: { 
          note: 'Driver type not set, using manual values',
          driverPay: safeFloat(leg.driverPay || 0),
          fuelCost: safeFloat(leg.fuelCost || 0)
        }
      },
      errors: ['Driver type not set - using manual entry']
    };
  }

  // Sanitize inputs
  distance = Math.max(0, safeFloat(distance || leg.totalDistance || 0));
  hours = Math.max(0, safeFloat(hours || leg.totalHours || 0));
  const payRate = Math.max(0, safeFloat(leg.payRate || leg.driverPay || 0));
  const fuelEfficiency = Math.max(0.1, safeFloat(leg.fuelEfficiency || 0));
  const fuelPrice = Math.max(0, safeFloat(leg.fuelPrice || 0));
  
  let driverWage = 0;
  let fuelCost = 0;
  let total = 0;
  let breakdown = {};
  let errors = [];

  // ========== DRIVER TYPE: OWNER OPERATOR ==========
  if (leg.driverType === 'Owner Operator') {
    if (leg.payType === 'hourly' && hours > 0) {
      driverWage = payRate * hours;
      breakdown = {
        driverWage,
        fuelCost: 0,
        fuelConsumption: 0,
        calculationMethod: 'Owner Operator (Hourly)',
        details: {
          rate: payRate,
          unit: 'hours',
          quantity: hours,
          hours: hours,
          totalWage: driverWage
        }
      };
    } else if (leg.payType === 'mileage' && distance > 0) {
      driverWage = payRate * distance;
      breakdown = {
        driverWage,
        fuelCost: 0,
        fuelConsumption: 0,
        calculationMethod: 'Owner Operator (Per Mile)',
        details: {
          rate: payRate,
          unit: 'km',
          quantity: distance,
          distance: distance,
          totalWage: driverWage
        }
      };
    } else {
      driverWage = payRate;
      breakdown = {
        driverWage,
        fuelCost: 0,
        fuelConsumption: 0,
        calculationMethod: 'Owner Operator (Per Leg)',
        details: {
          rate: payRate,
          unit: 'leg',
          quantity: 1,
          totalWage: driverWage
        }
      };
    }
    
    total = driverWage;
    
    if (safeFloat(leg.fuelCost) > 0) {
      errors.push('Fuel cost should be 0 for Owner Operators');
    }
  }
  
  // ========== DRIVER TYPE: THIRD-PARTY DRIVER ==========
  else if (leg.driverType === 'Third-Party Driver') {
    let baseRate = payRate;
    const markupPercentage = Math.max(0, safeFloat(leg.markupPercentage || 0));
    
    if (markupPercentage > 0) {
      driverWage = baseRate * (1 + markupPercentage / 100);
    } else {
      driverWage = baseRate;
    }
    
    fuelCost = 0;
    
    breakdown = {
      driverWage,
      fuelCost,
      fuelConsumption: 0,
      calculationMethod: 'Third-Party Driver',
      details: {
        baseRate: baseRate,
        markup: markupPercentage,
        finalRate: driverWage,
        isMarkupApplied: markupPercentage > 0
      }
    };
    
    total = driverWage;
    
    if (safeFloat(leg.fuelCost) > 0) {
      errors.push('Fuel cost should be included in Third-Party rate');
    }
  }
  
  // ========== DRIVER TYPE: COMPANY DRIVER ==========
  else if (leg.driverType === 'Company Driver') {
    if (leg.payType === 'hourly' && hours > 0) {
      driverWage = payRate * hours;
    } else if (leg.payType === 'mileage' && distance > 0) {
      driverWage = payRate * distance;
    } else {
      driverWage = payRate * Math.max(hours, 1);
      if (hours === 0) {
        errors.push('Hours not set - using 1 hour as fallback');
      }
    }
    
    if (fuelEfficiency > 0 && fuelPrice > 0 && distance > 0) {
      const fuelConsumption = distance / fuelEfficiency;
      fuelCost = fuelConsumption * fuelPrice;
      
      breakdown = {
        driverWage,
        fuelCost,
        fuelConsumption,
        calculationMethod: 'Company Driver (Wage + Fuel)',
        details: {
          hours: hours,
          distance: distance,
          hourlyRate: payRate,
          fuelEfficiency: fuelEfficiency,
          fuelPrice: fuelPrice,
          fuelConsumption: fuelConsumption,
          driverWage: driverWage,
          fuelCost: fuelCost,
          totalCost: driverWage + fuelCost
        }
      };
    } else {
      breakdown = {
        driverWage,
        fuelCost: 0,
        fuelConsumption: 0,
        calculationMethod: 'Company Driver (Wage Only)',
        details: {
          hours: hours,
          hourlyRate: payRate,
          driverWage: driverWage,
          note: 'Fuel data incomplete'
        }
      };
      
      if (fuelEfficiency === 0) {
        errors.push('Fuel efficiency not set');
      }
      if (fuelPrice === 0) {
        errors.push('Fuel price not set');
      }
      if (distance === 0) {
        errors.push('Distance not set');
      }
    }
    
    total = driverWage + fuelCost;
  }
  
  // ========== FALLBACK: UNKNOWN DRIVER TYPE ==========
  else {
    driverWage = safeFloat(leg.driverPay || 0);
    fuelCost = safeFloat(leg.fuelCost || 0);
    total = driverWage + fuelCost;
    
    breakdown = {
      driverWage,
      fuelCost,
      fuelConsumption: 0,
      calculationMethod: 'Unknown Driver Type (Manual)',
      details: {
        driverType: leg.driverType || 'Unknown',
        note: 'Using manual entries as fallback'
      }
    };
    
    errors.push(`Unknown driver type: ${leg.driverType || 'Not specified'}`);
  }
  
  return {
    driverWage,
    fuelCost,
    total,
    breakdown,
    errors: errors.length > 0 ? errors : undefined
  };
};

// ========== LOAD COST SUMMARY ==========
export const calculateLoadCosts = (formData) => {
  const totalDriverCost = (formData.legs || []).reduce((sum, leg) => {
    return sum + safeFloat(leg.calculatedCost || leg.driverPay + leg.fuelCost);
  }, 0);
  
  const totalFuelCost = (formData.legs || []).reduce((sum, leg) => {
    return sum + safeFloat(leg.fuelCost || 0);
  }, 0);
  
  const totalExpenses = (formData.expenseItems || []).reduce((sum, item) => {
    return sum + safeFloat(item.amount);
  }, 0);
  
  const totalRevenue = (formData.revenueItems || []).reduce((sum, item) => {
    return sum + safeFloat(item.amount);
  }, 0);
  
  const totalCost = totalDriverCost + totalExpenses;
  const profit = totalRevenue - totalCost;
  const profitMargin = totalRevenue > 0 ? (profit / totalRevenue * 100) : 0;
  
  // Breakdown by driver type
  const driverTypeBreakdown = {};
  (formData.legs || []).forEach(leg => {
    const type = leg.driverType || 'Unknown';
    const cost = safeFloat(leg.calculatedCost || leg.driverPay + leg.fuelCost);
    if (!driverTypeBreakdown[type]) {
      driverTypeBreakdown[type] = 0;
    }
    driverTypeBreakdown[type] += cost;
  });
  
  return {
    totalDriverCost,
    totalFuelCost,
    totalExpenses,
    totalRevenue,
    totalCost,
    profit,
    profitMargin,
    driverTypeBreakdown
  };
};

// ========== DRIVER ANALYTICS ==========
export const getDriverCostAnalytics = (loads, driverName) => {
  const driverLoads = loads.filter(load => 
    (load.legs || []).some(leg => leg.driverName === driverName)
  );
  
  let totalCost = 0;
  let totalDistance = 0;
  let totalHours = 0;
  let totalFuelCost = 0;
  let totalRevenue = 0;
  let completedLoads = 0;
  
  driverLoads.forEach(load => {
    let loadAssigned = false;
    (load.legs || []).forEach(leg => {
      if (leg.driverName === driverName) {
        loadAssigned = true;
        totalCost += safeFloat(leg.calculatedCost || leg.driverPay + leg.fuelCost);
        totalDistance += safeFloat(leg.totalDistance);
        totalHours += safeFloat(leg.totalHours);
        totalFuelCost += safeFloat(leg.fuelCost);
      }
    });
    if (loadAssigned && load.status === 'Completed') {
      completedLoads++;
    }
    if (loadAssigned) {
      const totalLegs = (load.legs || []).length;
      totalRevenue += safeFloat(load.rate || 0) / Math.max(totalLegs, 1);
    }
  });
  
  const profit = totalRevenue - totalCost;
  const profitMargin = totalRevenue > 0 ? (profit / totalRevenue * 100) : 0;
  
  return {
    driverName,
    totalCost,
    totalDistance,
    totalHours,
    totalFuelCost,
    totalRevenue,
    profit,
    profitMargin,
    completedLoads,
    costPerKm: totalDistance > 0 ? totalCost / totalDistance : 0,
    costPerHour: totalHours > 0 ? totalCost / totalHours : 0,
    fuelCostPerKm: totalDistance > 0 ? totalFuelCost / totalDistance : 0,
    revenuePerKm: totalDistance > 0 ? totalRevenue / totalDistance : 0,
    utilizationRate: totalHours > 0 ? (totalHours / (completedLoads * 8)) * 100 : 0
  };
};

// ========== BULK FUEL PRICE UPDATE ==========
export const updateFuelPriceForLegs = (legs, fuelPrice) => {
  return legs.map(leg => {
    if (leg.driverType === 'Company Driver') {
      const updatedLeg = { ...leg, fuelPrice: safeFloat(fuelPrice) };
      const calculated = calculateLegCost(updatedLeg, leg.totalDistance, leg.totalHours);
      return {
        ...updatedLeg,
        driverPay: calculated.driverWage,
        fuelCost: calculated.fuelCost,
        calculatedCost: calculated.total,
        costBreakdown: calculated.breakdown
      };
    }
    return leg;
  });
};

// ========== EXPORT SAFE FLOAT ==========
export { safeFloat };