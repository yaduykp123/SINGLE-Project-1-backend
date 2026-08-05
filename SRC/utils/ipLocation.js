// SRC/utils/ipLocation.js

export function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress || req.ip;
}

export async function lookupLocationByIp(ip) {
  const isLoopback = !ip || ip === "::1" || ip === "127.0.0.1" || ip === "localhost" || ip === "::ffff:127.0.0.1";
  
  const isPrivate = (ipAddress) => {
    if (!ipAddress) return true;
    const parts = ipAddress.split(".");
    if (parts.length === 4) {
      const first = parseInt(parts[0], 10);
      const second = parseInt(parts[1], 10);
      return (
        first === 10 ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168)
      );
    }
    return ipAddress.startsWith("fe80:") || ipAddress.startsWith("fc00:") || ipAddress === "::";
  };

  if (isLoopback || isPrivate(ip)) {
    return { city: "", state: "", country: "", latitude: null, longitude: null };
  }

  const cleanIp = ip;

  // 1. Try ipapi.co
  try {
    const url = `https://ipapi.co/${cleanIp}/json/`;

    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      if (data.city && data.city !== "Not found") {
        return {
          city: data.city || "",
          state: data.region || "",
          country: data.country_name || "",
          latitude: data.latitude ?? null,
          longitude: data.longitude ?? null,
        };
      }
    }
  } catch (err) {
    console.warn("ipapi.co failed:", err.message);
  }

  // 2. Try geolocation-db.com
  try {
    const url = cleanIp 
      ? `https://geolocation-db.com/json/${cleanIp}` 
      : "https://geolocation-db.com/json/";

    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      if (data.city && data.city !== "Not found") {
        return {
          city: data.city || "",
          state: data.state || "",
          country: data.country_name || "",
          latitude: data.latitude ?? null,
          longitude: data.longitude ?? null,
        };
      }
    }
  } catch (err) {
    console.warn("geolocation-db failed:", err.message);
  }

  // 3. Try ipinfo.io
  try {
    const url = cleanIp
      ? `https://ipinfo.io/${cleanIp}/json`
      : "https://ipinfo.io/json";

    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      const [lat, lon] = (data.loc || "").split(",").map(Number);
      return {
        city: data.city || "",
        state: data.region || "",
        country: data.country || "",
        latitude: isNaN(lat) ? null : lat,
        longitude: isNaN(lon) ? null : lon,
      };
    }
  } catch (err) {
    console.error("All IP lookups failed:", err.message);
  }

  // Final fallback - always null, never "Not found"
  return { city: "", state: "", country: "", latitude: null, longitude: null };
}