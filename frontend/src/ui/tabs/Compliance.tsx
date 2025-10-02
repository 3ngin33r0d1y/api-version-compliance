import React, { useState, useEffect, useMemo } from "react";
import { AlertTriangle, CheckCircle, RefreshCw, Shield, TrendingUp, AlertCircle, Zap, Globe, Server, Eye, ExternalLink } from "lucide-react";
import { useData } from '../useData';
import api from "../../lib/api";

type ApiResponse = {
    service: string;
    version: string;
    url: string;
    status: string;
    environment: string;
    region: string;
    responseTime?: number;
    projectId?: number;
    projectName?: string;
};

type ServiceViolation = {
    service: string;
    projectName: string;
    violation: string;
    severity: 'critical' | 'warning' | 'info';
    environments: {
        dev?: string;
        uat?: string;
        oat?: string;
        prod?: string;
    };
};

type ComplianceResult = {
    services: Record<string, Record<string, ApiResponse>>;
    violations: ServiceViolation[];
    totalViolations: number;
    criticalViolations: number;
    warningViolations: number;
    compliantServices: number;
    totalServices: number;
    complianceScore: number;
    timestamp: string;
};

export default function Compliance() {
    const { state } = useData(true);
    const [complianceData, setComplianceData] = useState<ComplianceResult | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);

    const checkCompliance = async () => {
        setLoading(true);
        setError(null);
        
        try {
            // Group APIs by service name and project
            const serviceGroups: Record<string, Record<string, ApiResponse>> = {};
            const violations: ServiceViolation[] = [];
            
            // Process all APIs from the database
            for (const apiItem of state.apis) {
                try {
                    // Fetch API data
                    const response = await fetch(apiItem.url);
                    const data = await response.json();
                    
                    const serviceName = data.service || extractServiceFromUrl(apiItem.url);
                    const projectName = state.projects.find(p => p.id === apiItem.projectId)?.name || 'Unknown Project';
                    
                    const serviceKey = `${serviceName}-${apiItem.projectId}`;
                    
                    if (!serviceGroups[serviceKey]) {
                        serviceGroups[serviceKey] = {};
                    }
                    
                    const envKey = normalizeEnvironment(apiItem.environment);
                    serviceGroups[serviceKey][envKey] = {
                        service: serviceName,
                        version: data.version || '0.0.0',
                        url: apiItem.url,
                        status: response.ok ? 'online' : 'offline',
                        environment: envKey,
                        region: apiItem.region || 'unknown',
                        responseTime: Math.floor(Math.random() * 200) + 50,
                        projectId: apiItem.projectId,
                        projectName: projectName
                    };
                } catch (err) {
                    console.error(`Failed to fetch ${apiItem.url}:`, err);
                    
                    const serviceName = extractServiceFromUrl(apiItem.url);
                    const projectName = state.projects.find(p => p.id === apiItem.projectId)?.name || 'Unknown Project';
                    const serviceKey = `${serviceName}-${apiItem.projectId}`;
                    
                    if (!serviceGroups[serviceKey]) {
                        serviceGroups[serviceKey] = {};
                    }
                    
                    const envKey = normalizeEnvironment(apiItem.environment);
                    serviceGroups[serviceKey][envKey] = {
                        service: serviceName,
                        version: '0.0.0',
                        url: apiItem.url,
                        status: 'offline',
                        environment: envKey,
                        region: apiItem.region || 'unknown',
                        responseTime: 0,
                        projectId: apiItem.projectId,
                        projectName: projectName
                    };
                }
            }

            // Check compliance for each service
            for (const [serviceKey, environments] of Object.entries(serviceGroups)) {
                const serviceViolations = checkServiceCompliance(environments);
                violations.push(...serviceViolations);
            }

            // Calculate compliance metrics
            const totalServices = Object.keys(serviceGroups).length;
            const servicesWithViolations = new Set(violations.map(v => `${v.service}-${v.projectName}`)).size;
            const compliantServices = totalServices - servicesWithViolations;
            const criticalViolations = violations.filter(v => v.severity === 'critical').length;
            const warningViolations = violations.filter(v => v.severity === 'warning').length;
            const complianceScore = totalServices > 0 ? Math.round((compliantServices / totalServices) * 100) : 100;

            const complianceResult: ComplianceResult = {
                services: serviceGroups,
                violations,
                totalViolations: violations.length,
                criticalViolations,
                warningViolations,
                compliantServices,
                totalServices,
                complianceScore,
                timestamp: new Date().toISOString()
            };
            
            setComplianceData(complianceResult);
            setLastUpdated(new Date());
        } catch (err: any) {
            setError(err.message || "Failed to check compliance");
        } finally {
            setLoading(false);
        }
    };

    const extractServiceFromUrl = (url: string): string => {
        try {
            const hostname = new URL(url).hostname;
            return hostname.split('.')[0] || 'unknown-service';
        } catch {
            return 'unknown-service';
        }
    };

    const normalizeEnvironment = (env: string): string => {
        const normalized = env.toLowerCase();
        if (normalized.includes('prod')) return 'prod';
        if (normalized.includes('oat')) return 'oat';
        if (normalized.includes('uat')) return 'uat';
        if (normalized.includes('dev')) return 'dev';
        return normalized;
    };

    const checkServiceCompliance = (environments: Record<string, ApiResponse>): ServiceViolation[] => {
        const violations: ServiceViolation[] = [];
        const { dev, uat, oat, prod } = environments;

        if (!dev && !uat && !oat && !prod) return violations;

        const firstEnv = [dev, uat, oat, prod].find(Boolean);
        const serviceName = firstEnv?.service ?? 'unknown';
        const projectName = firstEnv?.projectName ?? 'Unknown Project';

        const envVersions = {
            dev: dev?.version,
            uat: uat?.version,
            oat: oat?.version,
            prod: prod?.version,
        };

        // ---------- Rule A: PROD must NOT be ahead of OAT or UAT ----------
        if (prod?.version && oat?.version && compareVersions(prod.version, oat.version) > 0) {
            violations.push({
                service: serviceName,
                projectName,
                violation: `CRITICAL: PROD version (${prod.version}) is higher than OAT version (${oat.version}). Rule: PROD version can't be higher than OAT or UAT env.`,
                severity: 'critical',
                environments: envVersions,
            });
        }

        if (prod?.version && uat?.version && compareVersions(prod.version, uat.version) > 0) {
            violations.push({
                service: serviceName,
                projectName,
                violation: `CRITICAL: PROD version (${prod.version}) is higher than UAT version (${uat.version}). Rule: PROD version can't be higher than OAT or UAT env.`,
                severity: 'critical',
                environments: envVersions,
            });
        }

        // ---------- Rule B: OAT must NOT be ahead of UAT ----------
        if (oat?.version && uat?.version && compareVersions(oat.version, uat.version) > 0) {
            violations.push({
                service: serviceName,
                projectName,
                violation: `WARNING: OAT version (${oat.version}) is higher than UAT version (${uat.version}). Rule: OAT version can't be higher than UAT env.`,
                severity: 'warning',
                environments: envVersions,
            });
        }

        // (Optional) Environment presence sanity check
        if (prod?.version && !uat?.version) {
            violations.push({
                service: serviceName,
                projectName,
                violation: `WARNING: PROD exists (${prod.version}) but UAT environment is missing`,
                severity: 'warning',
                environments: envVersions,
            });
        }

        return violations;
    };


    const compareVersions = (version1: string, version2: string): number => {
        const v1Parts = version1.split('.').map(Number);
        const v2Parts = version2.split('.').map(Number);
        
        const maxLength = Math.max(v1Parts.length, v2Parts.length);
        
        for (let i = 0; i < maxLength; i++) {
            const v1Part = v1Parts[i] || 0;
            const v2Part = v2Parts[i] || 0;
            
            if (v1Part !== v2Part) {
                return v1Part - v2Part;
            }
        }
        
        return 0;
    };

    useEffect(() => {
        if (state.apis.length > 0) {
            checkCompliance();
        }
    }, [state.apis]);

    useEffect(() => {
        let interval: NodeJS.Timeout;
        if (autoRefresh && state.apis.length > 0) {
            interval = setInterval(checkCompliance, 30000);
        }
        
        return () => {
            if (interval) clearInterval(interval);
        };
    }, [autoRefresh, state.apis]);

    const getSeverityColor = (severity: string) => {
        switch (severity) {
            case 'critical': return 'text-red-700 bg-red-50 border-red-200';
            case 'warning': return 'text-yellow-700 bg-yellow-50 border-yellow-200';
            default: return 'text-blue-700 bg-blue-50 border-blue-200';
        }
    };

    const getSeverityIcon = (severity: string) => {
        switch (severity) {
            case 'critical': return <AlertCircle className="h-5 w-5 text-red-600" />;
            case 'warning': return <AlertTriangle className="h-5 w-5 text-yellow-600" />;
            default: return <CheckCircle className="h-5 w-5 text-blue-600" />;
        }
    };

    const getEnvironmentColor = (env: string) => {
        switch (env) {
            case 'prod': return 'bg-red-500 text-white';
            case 'oat': return 'bg-orange-500 text-white';
            case 'uat': return 'bg-yellow-500 text-white';
            case 'dev': return 'bg-green-500 text-white';
            default: return 'bg-gray-500 text-white';
        }
    };

    if (state.apis.length === 0) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
                <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50 sticky top-0 z-10">
                    <div className="max-w-7xl mx-auto px-6 py-4">
                        <div className="flex items-center space-x-4">
                            <div className="p-2 bg-gradient-to-r from-red-600 to-orange-600 rounded-xl">
                                <Shield className="h-8 w-8 text-white" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
                                    Compliance Monitoring
                                </h1>
                                <p className="text-gray-600 text-sm">Version compliance validation across environments</p>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div className="max-w-7xl mx-auto px-6 py-8">
                    <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 p-12 text-center">
                        <Server className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                        <h3 className="text-xl font-semibold text-gray-900 mb-2">No APIs to Monitor</h3>
                        <p className="text-gray-600">Add some APIs to your projects to start monitoring compliance</p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
            {/* Header */}
            <div className="bg-white/80 backdrop-blur-sm border-b border-gray-200/50 sticky top-0 z-10">
                <div className="max-w-7xl mx-auto px-6 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                            <div className="p-2 bg-gradient-to-r from-red-600 to-orange-600 rounded-xl">
                                <Shield className="h-8 w-8 text-white" />
                            </div>
                            <div>
                                <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
                                    Compliance Monitoring
                                </h1>
                                <p className="text-gray-600 text-sm">Version compliance validation across environments</p>
                            </div>
                        </div>
                        <div className="flex items-center space-x-3">
                            <div className="flex items-center space-x-2 text-sm text-gray-600 bg-gray-100 px-3 py-2 rounded-lg">
                                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                                <span>
                                    {lastUpdated ? `Updated: ${lastUpdated.toLocaleTimeString()}` : 'Never updated'}
                                </span>
                            </div>
                            <button
                                onClick={checkCompliance}
                                disabled={loading}
                                className="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-red-600 to-orange-600 text-white rounded-xl hover:from-red-700 hover:to-orange-700 disabled:opacity-50 transition-all duration-200 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5"
                            >
                                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                                <span className="font-medium">Check Compliance</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-6 py-8">
                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-2xl p-6 mb-8">
                        <div className="flex items-center space-x-3">
                            <AlertCircle className="h-6 w-6 text-red-600" />
                            <div>
                                <h3 className="text-lg font-semibold text-red-800">Compliance Check Failed</h3>
                                <p className="text-red-700 mt-1">{error}</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Compliance Overview */}
                {complianceData && (
                    <>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 p-6">
                                <div className="flex items-center space-x-3">
                                    <div className="p-3 bg-gradient-to-r from-blue-500 to-blue-600 rounded-xl">
                                        <Server className="h-6 w-6 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-semibold text-gray-900">Total Services</h3>
                                        <p className="text-3xl font-bold text-blue-600">{complianceData.totalServices}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 p-6">
                                <div className="flex items-center space-x-3">
                                    <div className="p-3 bg-gradient-to-r from-red-500 to-red-600 rounded-xl">
                                        <AlertCircle className="h-6 w-6 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-semibold text-gray-900">Total Violations</h3>
                                        <p className="text-3xl font-bold text-red-600">{complianceData.totalViolations}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 p-6">
                                <div className="flex items-center space-x-3">
                                    <div className="p-3 bg-gradient-to-r from-orange-500 to-orange-600 rounded-xl">
                                        <AlertTriangle className="h-6 w-6 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-semibold text-gray-900">Critical Issues</h3>
                                        <p className="text-3xl font-bold text-orange-600">{complianceData.criticalViolations}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 p-6">
                                <div className="flex items-center space-x-3">
                                    <div className={`p-3 bg-gradient-to-r rounded-xl ${
                                        complianceData.complianceScore >= 90 ? 'from-green-500 to-emerald-600' : 
                                        complianceData.complianceScore >= 70 ? 'from-yellow-500 to-orange-500' : 
                                        'from-red-500 to-red-600'
                                    }`}>
                                        <Shield className="h-6 w-6 text-white" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-semibold text-gray-900">Compliance Score</h3>
                                        <p className={`text-3xl font-bold ${
                                            complianceData.complianceScore >= 90 ? 'text-green-600' : 
                                            complianceData.complianceScore >= 70 ? 'text-yellow-600' : 
                                            'text-red-600'
                                        }`}>
                                            {complianceData.complianceScore}%
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Violations List */}
                        {complianceData.violations.length > 0 ? (
                            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 overflow-hidden mb-8">
                                <div className="px-6 py-4 bg-gradient-to-r from-red-50 to-orange-50 border-b border-gray-200">
                                    <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
                                        <AlertTriangle className="h-5 w-5 text-red-600" />
                                        <span>Compliance Violations ({complianceData.violations.length})</span>
                                    </h3>
                                </div>
                                
                                <div className="p-6">
                                    <div className="space-y-4">
                                        {complianceData.violations.map((violation, index) => (
                                            <div
                                                key={index}
                                                className={`p-4 rounded-xl border-2 ${getSeverityColor(violation.severity)}`}
                                            >
                                                <div className="flex items-start space-x-3">
                                                    {getSeverityIcon(violation.severity)}
                                                    <div className="flex-1">
                                                        <div className="flex items-center space-x-2 mb-2">
                                                            <h4 className="font-semibold">{violation.service}</h4>
                                                            <span className="text-sm text-gray-600">in {violation.projectName}</span>
                                                        </div>
                                                        <p className="text-sm mb-3">{violation.violation}</p>
                                                        <div className="flex items-center space-x-2">
                                                            {Object.entries(violation.environments).map(([env, version]) => 
                                                                version ? (
                                                                    <span
                                                                        key={env}
                                                                        className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${getEnvironmentColor(env)}`}
                                                                    >
                                                                        {env.toUpperCase()}: v{version}
                                                                    </span>
                                                                ) : null
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 p-12 text-center mb-8">
                                <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
                                <h3 className="text-xl font-semibold text-gray-900 mb-2">All Services Compliant</h3>
                                <p className="text-gray-600">No version compliance violations detected across all environments</p>
                            </div>
                        )}

                        {/* Service Matrix */}
                        <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 overflow-hidden">
                            <div className="px-6 py-4 bg-gradient-to-r from-gray-50 to-blue-50 border-b border-gray-200">
                                <h3 className="text-lg font-semibold text-gray-900 flex items-center space-x-2">
                                    <Globe className="h-5 w-5" />
                                    <span>Service Environment Matrix</span>
                                </h3>
                            </div>
                            
                            <div className="p-6">
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead>
                                            <tr className="border-b border-gray-200">
                                                <th className="text-left py-3 px-4 font-semibold text-gray-900">Service</th>
                                                <th className="text-left py-3 px-4 font-semibold text-gray-900">Project</th>
                                                <th className="text-center py-3 px-4 font-semibold text-gray-900">DEV</th>
                                                <th className="text-center py-3 px-4 font-semibold text-gray-900">UAT</th>
                                                <th className="text-center py-3 px-4 font-semibold text-gray-900">OAT</th>
                                                <th className="text-center py-3 px-4 font-semibold text-gray-900">PROD</th>
                                                <th className="text-center py-3 px-4 font-semibold text-gray-900">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {Object.entries(complianceData.services).map(([serviceKey, environments]) => {
                                                const firstEnv = Object.values(environments)[0];
                                                const hasViolations = complianceData.violations.some(v => 
                                                    v.service === firstEnv?.service && v.projectName === firstEnv?.projectName
                                                );
                                                
                                                return (
                                                    <tr key={serviceKey} className="border-b border-gray-100 hover:bg-gray-50">
                                                        <td className="py-3 px-4 font-medium text-gray-900">{firstEnv?.service}</td>
                                                        <td className="py-3 px-4 text-gray-600">{firstEnv?.projectName}</td>
                                                        <td className="py-3 px-4 text-center">
                                                            {environments.dev ? (
                                                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                                                    v{environments.dev.version}
                                                                </span>
                                                            ) : (
                                                                <span className="text-gray-400">—</span>
                                                            )}
                                                        </td>
                                                        <td className="py-3 px-4 text-center">
                                                            {environments.uat ? (
                                                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                                                                    v{environments.uat.version}
                                                                </span>
                                                            ) : (
                                                                <span className="text-gray-400">—</span>
                                                            )}
                                                        </td>
                                                        <td className="py-3 px-4 text-center">
                                                            {environments.oat ? (
                                                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                                                                    v{environments.oat.version}
                                                                </span>
                                                            ) : (
                                                                <span className="text-gray-400">—</span>
                                                            )}
                                                        </td>
                                                        <td className="py-3 px-4 text-center">
                                                            {environments.prod ? (
                                                                <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                                                    v{environments.prod.version}
                                                                </span>
                                                            ) : (
                                                                <span className="text-gray-400">—</span>
                                                            )}
                                                        </td>
                                                        <td className="py-3 px-4 text-center">
                                                            {hasViolations ? (
                                                                <AlertCircle className="h-5 w-5 text-red-500 mx-auto" />
                                                            ) : (
                                                                <CheckCircle className="h-5 w-5 text-green-500 mx-auto" />
                                                            )}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
