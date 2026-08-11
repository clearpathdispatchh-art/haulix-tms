// components/DriverPayroll.jsx
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  DollarSign, Calendar, Download, Printer, Search, Filter,
  ChevronDown, ChevronUp, User, Truck, Clock, AlertCircle,
  FileText, CheckCircle, XCircle, TrendingUp, Wallet,
  Calculator, Receipt, CalendarDays, RefreshCw, Loader2
} from 'lucide-react';

const DriverPayroll = ({
  drivers,
  loads,
  companyId,
  onRefresh,
  isAdmin,
  isAccounting,
  setFeedback
}) => {
  const [selectedDriverId, setSelectedDriverId] = useState(null);
  const [payPeriod, setPayPeriod] = useState('biweekly');
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [showDetails, setShowDetails] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [payrollData, setPayrollData] = useState(null);

  // Pay periods presets
  const payPeriods = [
    { value: 'weekly', label: 'Weekly (7 days)' },
    { value: 'biweekly', label: 'Bi-Weekly (14 days)' },
    { value: 'monthly', label: 'Monthly (30 days)' },
    { value: 'custom', label: 'Custom Range' }
  ];

  // ✅ STEP 1 & 2: FIXED calculateDriverPay with driver type logic
  const calculateDriverPay = useCallback((driverId, start, end) => {
    const driver = drivers.find(d => d.id === driverId);
    if (!driver) return null;

    // Find all loads where this driver is assigned
    const relevantLoads = loads.filter(load => {
      const legs = load.legs || [];
      const hasDriver = legs.some(leg => leg.driverName === driver.name);
      if (!hasDriver) return false;
      
      // Check if in date range
      const loadDate = load.appointmentDate || load.createdAt?.split('T')[0];
      return loadDate >= start && loadDate <= end;
    });

    let totalPay = 0;
    let totalFuel = 0;
    let totalDetention = 0;
    let totalGross = 0;
    const trips = [];

    relevantLoads.forEach(load => {
      const legs = load.legs || [];
      legs.forEach(leg => {
        if (leg.driverName === driver.name) {
          const pay = parseFloat(leg.driverPay) || 0;
          const fuel = parseFloat(leg.fuelCost) || 0;
          const detention = parseFloat(leg.detentionPay) || 0;

          totalPay += pay;
          totalFuel += fuel;
          totalDetention += detention;

          // ✅ FIX: Gross pay is driver pay + detention ONLY
          // Fuel is tracked separately based on driver type
          const gross = pay + detention;
          totalGross += gross;

          trips.push({
            loadId: load.id,
            workOrderNo: load.workOrderNo || 'N/A',
            containerNo: load.containerNo || 'N/A',
            from: leg.from || 'N/A',
            to: leg.to || 'N/A',
            date: load.appointmentDate || load.createdAt?.split('T')[0] || 'N/A',
            status: leg.status || 'Planned',
            driverPay: pay,
            fuelCost: fuel,
            detentionPay: detention,
            grossPay: gross,
            customer: load.customerName || 'N/A'
          });
        }
      });
    });

    // Sort trips by date
    trips.sort((a, b) => (a.date > b.date ? -1 : 1));

    // ✅ FIX: Calculate net pay based on driver type
    let netPay = totalGross; // Start with gross pay
    
    if (driver.type === 'Company Driver') {
      // Company Driver: Company pays for fuel
      // Net pay = Gross pay + Fuel cost (company reimburses fuel)
      netPay = totalGross + totalFuel;
    } else if (driver.type === 'Owner Operator') {
      // Owner Operator: Pays their own fuel
      // Net pay = Gross pay ONLY (no fuel added)
      netPay = totalGross;
      // Fuel is tracked separately for reporting
    } else {
      // Third-Party Driver: Separate arrangement, just gross pay
      netPay = totalGross;
    }

    return {
      driver: driver,
      totalPay: totalPay,
      totalFuel: totalFuel,
      totalDetention: totalDetention,
      totalGross: totalGross,
      netPay: netPay, // ✅ CORRECT: Based on driver type
      tripCount: trips.length,
      trips: trips,
      period: { start, end },
      driverType: driver.type || 'Company Driver' // ✅ Add driver type to return
    };
  }, [drivers, loads]);

  // Generate payroll report
  const generatePayroll = useCallback(async () => {
    setIsGenerating(true);
    try {
      const selectedDriver = drivers.find(d => d.id === selectedDriverId);
      if (!selectedDriver) {
        setFeedback('❌ Please select a driver');
        return;
      }

      // Determine actual date range
      let start = startDate;
      let end = endDate;
      
      if (payPeriod !== 'custom') {
        const today = new Date();
        const days = payPeriod === 'weekly' ? 7 : payPeriod === 'biweekly' ? 14 : 30;
        const d = new Date();
        d.setDate(d.getDate() - days);
        start = d.toISOString().split('T')[0];
        end = today.toISOString().split('T')[0];
        setStartDate(start);
        setEndDate(end);
      }

      const result = calculateDriverPay(selectedDriverId, start, end);
      setPayrollData(result);
      setShowDetails(selectedDriverId);
    } catch (error) {
      console.error('Error generating payroll:', error);
      setFeedback('❌ Failed to generate payroll report');
    } finally {
      setIsGenerating(false);
    }
  }, [selectedDriverId, drivers, startDate, endDate, payPeriod, calculateDriverPay, setFeedback]);

  // Auto-generate on selection change
  useEffect(() => {
    if (selectedDriverId) {
      generatePayroll();
    }
  }, [selectedDriverId, generatePayroll]);

  // ✅ STEP 6: Export payroll report with driver type
  const exportPayroll = useCallback(() => {
    if (!payrollData) return;

    const lines = [
      'DRIVER PAYROLL REPORT',
      '=======================',
      `Driver: ${payrollData.driver.name}`,
      `Truck: ${payrollData.driver.truckNo}`,
      `Driver Type: ${payrollData.driver.type || 'Company Driver'}`,
      `Period: ${payrollData.period.start} to ${payrollData.period.end}`,
      '',
      'SUMMARY',
      '-------',
      `Total Trips: ${payrollData.tripCount}`,
      `Gross Pay: $${payrollData.totalGross.toFixed(2)}`,
      `Total Fuel: $${payrollData.totalFuel.toFixed(2)}`,
      `Fuel Included In Pay: ${payrollData.driver.type === 'Company Driver' ? 'Yes' : 'No'}`,
      `Net Pay: $${payrollData.netPay.toFixed(2)}`,
      '',
      'TRIP DETAILS',
      '-------------',
      'WO # | Container | From → To | Date | Pay | Fuel | Detention',
      '--- | --- | --- | --- | --- | --- | ---'
    ];

    payrollData.trips.forEach(trip => {
      lines.push(
        `${trip.workOrderNo} | ${trip.containerNo} | ${trip.from} → ${trip.to} | ${trip.date} | $${trip.driverPay.toFixed(2)} | $${trip.fuelCost.toFixed(2)} | $${trip.detentionPay.toFixed(2)}`
      );
    });

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Driver_Payroll_${payrollData.driver.name}_${payrollData.period.start}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setFeedback('✅ Payroll report downloaded');
  }, [payrollData, setFeedback]);

  // Calculate totals for all drivers
  const driverSummary = useMemo(() => {
    if (!startDate || !endDate) return [];
    
    return drivers.map(driver => {
      const result = calculateDriverPay(driver.id, startDate, endDate);
      return result;
    }).filter(Boolean);
  }, [drivers, startDate, endDate, calculateDriverPay]);

  // ✅ Helper function for driver type badge
  const getDriverTypeBadge = (driver) => {
    const type = driver?.type || 'Company Driver';
    const styles = {
      'Company Driver': 'bg-blue-100 text-blue-700',
      'Owner Operator': 'bg-purple-100 text-purple-700',
      'Third-Party Driver': 'bg-orange-100 text-orange-700'
    };
    return styles[type] || 'bg-slate-100 text-slate-700';
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <DollarSign className="w-7 h-7 text-green-600" />
            Driver Payroll
          </h2>
          <p className="text-sm text-slate-500 font-medium">
            Calculate driver pay by trip legs - Owner-operators fuel costs are NOT included
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
        >
          <RefreshCw className="w-5 h-5 text-slate-500" />
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Select Driver
            </label>
            <select
              value={selectedDriverId || ''}
              onChange={(e) => setSelectedDriverId(e.target.value || null)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-blue-200 outline-none"
            >
              <option value="">Choose a driver...</option>
              {drivers.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name} (Truck: {d.truckNo || 'N/A'}) - {d.tripStatus || 'Idle'} - {d.type || 'Company Driver'}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Pay Period
            </label>
            <select
              value={payPeriod}
              onChange={(e) => {
                setPayPeriod(e.target.value);
                if (e.target.value !== 'custom') {
                  const today = new Date();
                  const days = e.target.value === 'weekly' ? 7 : e.target.value === 'biweekly' ? 14 : 30;
                  const d = new Date();
                  d.setDate(d.getDate() - days);
                  setStartDate(d.toISOString().split('T')[0]);
                  setEndDate(today.toISOString().split('T')[0]);
                }
              }}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-blue-200 outline-none"
            >
              {payPeriods.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={payPeriod !== 'custom'}
              className={`w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-blue-200 outline-none ${payPeriod !== 'custom' ? 'opacity-50 cursor-not-allowed' : ''}`}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={payPeriod !== 'custom'}
              className={`w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-bold bg-white focus:ring-2 focus:ring-blue-200 outline-none ${payPeriod !== 'custom' ? 'opacity-50 cursor-not-allowed' : ''}`}
            />
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <button
            onClick={generatePayroll}
            disabled={!selectedDriverId || isGenerating}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
            {isGenerating ? 'Calculating...' : 'Calculate Pay'}
          </button>
          {payrollData && payrollData.trips.length > 0 && (
            <>
              <button
                onClick={exportPayroll}
                className="px-6 py-2.5 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700 transition-colors flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                Export Report
              </button>
            </>
          )}
        </div>
      </div>

      {/* ✅ STEP 3: Payroll Summary Cards with driver type */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Driver Card */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-xl">
                <User className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase">Selected Driver</p>
                <p className="text-lg font-black text-slate-900">
                  {payrollData?.driver?.name || 'None Selected'}
                </p>
                {/* ✅ Driver type badge */}
                {payrollData?.driver && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${getDriverTypeBadge(payrollData.driver)}`}>
                    {payrollData.driver.type || 'Company Driver'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Trips Card */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-50 rounded-xl">
                <TrendingUp className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase">Trips</p>
                <p className="text-lg font-black text-slate-900">
                  {payrollData?.tripCount || 0}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Gross Pay Card */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-50 rounded-xl">
                <Wallet className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase">Gross Pay</p>
                <p className="text-lg font-black text-slate-900">
                  ${payrollData?.totalGross?.toFixed(2) || '0.00'}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ✅ STEP 4: Net Pay Card with driver type specific info */}
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl ${
                payrollData?.driver?.type === 'Owner Operator' 
                  ? 'bg-purple-100' 
                  : 'bg-green-100'
              }`}>
                <DollarSign className={`w-5 h-5 ${
                  payrollData?.driver?.type === 'Owner Operator' 
                    ? 'text-purple-700' 
                    : 'text-green-700'
                }`} />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase">Net Pay</p>
                <p className={`text-lg font-black ${
                  payrollData?.driver?.type === 'Owner Operator' 
                    ? 'text-purple-700' 
                    : 'text-green-700'
                }`}>
                  ${payrollData?.netPay?.toFixed(2) || '0.00'}
                </p>
                {/* ✅ Driver type specific info */}
                {payrollData && payrollData.driver?.type === 'Company Driver' && (
                  <p className="text-[9px] text-blue-600 font-bold">
                    ✅ Fuel included: +${payrollData.totalFuel.toFixed(2)}
                  </p>
                )}
                {payrollData && payrollData.driver?.type === 'Owner Operator' && (
                  <p className="text-[9px] text-purple-600 font-bold">
                    ⚠️ Fuel NOT included (owner pays own fuel): ${payrollData.totalFuel.toFixed(2)}
                  </p>
                )}
                {payrollData && !payrollData.driver?.type && (
                  <p className="text-[9px] text-orange-600 font-bold">
                    ℹ️ Third-party - fuel not included
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Trip Details Table */}
      {payrollData && payrollData.trips.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-slate-600" />
              <h3 className="font-black text-slate-900">Trip Details</h3>
              <span className="text-sm text-slate-500 font-medium ml-2">
                ({payrollData.trips.length} trips)
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowDetails(showDetails === selectedDriverId ? null : selectedDriverId)}
                className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
              >
                {showDetails === selectedDriverId ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </div>
          {showDetails === selectedDriverId && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase">
                    <th className="px-4 py-3">WO #</th>
                    <th className="px-4 py-3">Container</th>
                    <th className="px-4 py-3">From → To</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3 text-right">Pay</th>
                    <th className="px-4 py-3 text-right">Fuel</th>
                    <th className="px-4 py-3 text-right">Detention</th>
                    <th className="px-4 py-3 text-right">Gross</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payrollData.trips.map((trip, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors text-sm">
                      <td className="px-4 py-3 font-bold text-slate-700">{trip.workOrderNo}</td>
                      <td className="px-4 py-3 font-mono text-xs">{trip.containerNo}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium text-slate-600">
                          {trip.from.split(' - ')[0]} → {trip.to.split(' - ')[0]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-medium">{trip.date}</td>
                      <td className="px-4 py-3 text-right font-bold text-blue-600">
                        ${trip.driverPay.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-600">
                        ${trip.fuelCost.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-amber-600">
                        ${trip.detentionPay.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-green-600">
                        ${trip.grossPay.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  {/* Totals row */}
                  <tr className="bg-blue-50/50 border-t-2 border-blue-200">
                    <td colSpan="4" className="px-4 py-3 font-black text-slate-800">
                      TOTAL
                    </td>
                    <td className="px-4 py-3 text-right font-black text-blue-700">
                      ${payrollData.totalPay.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-black text-slate-700">
                      ${payrollData.totalFuel.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-black text-amber-700">
                      ${payrollData.totalDetention.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-black text-green-700">
                      ${payrollData.totalGross.toFixed(2)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ✅ STEP 5: All Drivers Summary with Driver Type column */}
      {driverSummary.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50">
            <h3 className="font-black text-slate-900 flex items-center gap-2">
              <Truck className="w-5 h-5 text-orange-600" />
              All Drivers Summary ({payPeriod})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase">
                  <th className="px-4 py-3">Driver</th>
                  <th className="px-4 py-3">Truck</th>
                  <th className="px-4 py-3 text-right">Trips</th>
                  <th className="px-4 py-3 text-right">Gross Pay</th>
                  <th className="px-4 py-3">Driver Type</th>
                  <th className="px-4 py-3 text-right">Net Pay</th>
                  <th className="px-4 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {driverSummary.map((data, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 transition-colors text-sm">
                    <td className="px-4 py-3 font-bold text-slate-800">{data.driver.name}</td>
                    <td className="px-4 py-3 font-mono text-xs">{data.driver.truckNo || 'N/A'}</td>
                    <td className="px-4 py-3 text-right font-bold">{data.tripCount}</td>
                    <td className="px-4 py-3 text-right font-bold text-blue-600">
                      ${data.totalGross.toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-1 rounded ${
                        data.driver.type === 'Company Driver' 
                          ? 'bg-blue-100 text-blue-700' 
                          : data.driver.type === 'Owner Operator'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-orange-100 text-orange-700'
                      }`}>
                        {data.driver.type || 'Company Driver'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-green-700">
                      ${data.netPay.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 rounded-lg text-[10px] font-black uppercase ${
                        data.tripCount > 0 
                          ? 'bg-green-50 text-green-700 border border-green-200'
                          : 'bg-slate-100 text-slate-400 border border-slate-200'
                      }`}>
                        {data.tripCount > 0 ? 'Active' : 'Idle'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default DriverPayroll;