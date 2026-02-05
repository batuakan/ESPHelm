#pragma once
#include <string>
#include "esphome.h"

// NOTE: this must be inline to avo&id multiple definition errors
inline esphome::image::Image *map_weather_icon(const std::string &cond) {
  if (cond == "sunny") return &id(weather_sunny);
  if (cond == "clear-night") return &id(weather_clear_night);
  if (cond == "cloudy") return &id(weather_cloudy);
  if (cond == "fog") return &id(weather_fog);
  if (cond == "hail") return &id(weather_hail);
  if (cond == "lightning") return &id(weather_lightning);
  if (cond == "lightning-rainy") return &id(weather_lightning_rainy);
  if (cond == "partlycloudy") return &id(weather_partlycloudy);
  if (cond == "pouring") return &id(weather_pouring);
  if (cond == "rainy") return &id(weather_rainy);
  if (cond == "snowy") return &id(weather_snowy);
  if (cond == "snowy-rainy") return &id(weather_snowy_rainy);
  if (cond == "windy") return &id(weather_windy);
  if (cond == "windy-variant") return &id(weather_windy_variant);
  if (cond == "exceptional") return &id(weather_exceptional);

  return &id(weather_default);
}

inline const char *map_weather_glyph(const std::string &cond) {
  if (cond == "sunny") return "\U000F0599";           // mdi-weather-sunny
  if (cond == "clear-night") return "\U000F0594";    // mdi-weather-night
  if (cond == "cloudy") return "\U000F0590";         // mdi-weather-cloudy
  if (cond == "fog") return "\U000F0591";             // mdi-weather-fog
  if (cond == "hail") return "\U000F0592";            // mdi-weather-hail
  if (cond == "lightning") return "\U000F0593";       // mdi-weather-lightning
  if (cond == "lightning-rainy") return "\U000F067E"; // mdi-weather-lightning-rainy
  if (cond == "partlycloudy") return "\U000F0595";    // mdi-weather-partly-cloudy
  if (cond == "pouring") return "\U000F0596";         // mdi-weather-pouring
  if (cond == "rainy") return "\U000F0597";           // mdi-weather-rainy
  if (cond == "snowy") return "\U000F0598";           // mdi-weather-snowy
  if (cond == "snowy-rainy") return "\U000F067F";     // mdi-weather-snowy-rainy
  if (cond == "windy") return "\U000F059D";           // mdi-weather-windy
  if (cond == "windy-variant") return "\U000F059E";   // mdi-weather-windy-variant
  if (cond == "exceptional") return "\U000F0F2F";     // mdi-weather-exceptional

  return "\U000F14E4"; // mdi-sunny-off (fallback)
}