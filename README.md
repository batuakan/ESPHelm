# ⚓ ESPHelm

**ESPHelm — Open-source ESP32 multifunction marine displays with native SignalK support.**

ESPHelm is a lightweight, open-source marine display platform built on ESP32.  
It connects directly to HomeAssistant and SignalK servers to provide real-time vessel data on affordable, customizable hardware.

---

<p align="center">
 <img width="200px" src="/docs/images/weather.png">
 <img width="200px" src="/docs/images/wind.png">
 <img width="200px" src="/docs/images/chart.png">
 <img width="200px" src="/docs/images/switchboard.png">
 <img width="200px" src="/docs/images/grid.png">
 <img width="200px" src="/docs/images/energy.png">
</p>

---

I have always wanted to have an multi function display (MFD) on my electric panel in my sailboat onky to have my jaw drop at very high prices.

This projects aims to be a collection of ESPHome recipes that collectively function as a MFD. 

For this project I have choosen the [ESP32-P4 Smart 86 display from waveshare](https://www.waveshare.com/esp32-p4-wifi6-touch-lcd-4b.htm) for its "classic" square look and its high resolution, high-performance, dual-core RISC-V architecture, however many of the concepts and applications does and should work with the ESP32 C3 and C6 boards. 

## 🌊 Features

- ESP32-based (low power, WiFi enabled)
- Modular sensor & display architecture
- Native SignalK integration
- Supports multiple screens / pages
- Touch/swipe control


## 🧭 Project Goals

- Affordable DIY multifunction displays
- Clean, hackable embedded architecture
- Easy to develop new applications
- Simple integration with existing SignalK setups
- Easy customization for different vessels and layouts


## Design Goals

This project uses ESPHome as the "programming environment" which is proven environment for setting up embedded iot devices with homeassistant integration with support for thousands of sensors. Integration with SignalK is handled by [EspHomeSignalK](https://github.com/batuakan/ESPHomeSignalK) external component, which is responsible for subscribing to singalk data paths and PUT request handling

- Each application should reside in its own yaml configuration
- Application should not depend on each other
- Each application should be screen resolution agnostic or at least agnostic for 480x480 and 720x720 displays
- Reusable components are always prefered 



## Applications

### Weather and clock

<img width="200px" src="/docs/images/weather.png">
<img width="200px" src="/docs/images/forecast.png">


Who doesnt need a stylish clock and weather forecast on their MFD!! This application displays the current time, current weather conditions and a 5 day forecast fetched from homeassistant showing: outlook, min/max temperature, wind direction, wind speed and gusts



### Wind

 <img width="200px" src="/docs/images/wind.png">

Not much to say here, a wind instrument application showing:

- SOG
- TWS
- AWS
- True Heading
- Compass rose
- Apparent Wind Direction
- True Wind Direction.

Rotating the compass rose on ESP32 C3 takes significant amount of resources, so comment it out if things get slow.

### Energy

 <img width="200px" src="/docs/images/energy.png">

A simple battery, solar, and shore power consumption contribution application showing

- House battery state of charge
- Shore power input in amp hours
- Solar input in amp hours
- House battery consumption in amp hours
- House battery voltage in volts (blue indicator)
- Engine battery voltage in volts (red indicator)

### Grid

 <img width="200px" src="/docs/images/grid.png">

A simple numeric display, if you dont want to see additional clutter showing

- Speed over ground
- Apparent wind speed
- True wind speed
- Speed through water

Modify according to your needs

**TODO:**

- [ ] It would be nice to see a graph of history behind the numeric values


### Anchor Watch / Chart

 <img width="200px" src="/docs/images/chart.png">
<img width="200px" src="/docs/images/anchor.png">

A simple chart utilizing SignalK charts (mbtiles or proxied/cached charts) using the [chart-plugin](https://github.com/SignalK/charts-plugin) and [signalk-rgb565-proxy](https://github.com/batuakan/SignalKRGB565Proxy) plugins. chart-plugin provides the charts and fetches them from the remote server if needed. rgb565 plugin decodes the image and converts it to raw pixel values in rgb565 16 bit format and sends them to the esp32 where it gets stiched together and displayed in the viewport using the [ESPTiles](https://github.com/batuakan/ESPTiles) external esphome component. The application centers the vessel on the display.

Additionally this application subscribes to anchor position and anchor maxRadius and displays an overlay over the chart showing the anchor swing area.

**TODO:**

- [ ] Clean up the view when the anchor is pulled up. Hide the anchor icon and the circle.
- [ ] Anchow view feels a little iffy as the data received for vessel position and anchor position is not syncronized.
- [ ] Display depth and current radius 
- [ ] Add GUI buttons to drop and pull the anchor

### Autopilot

 <img width="200px" src="/docs/images/autopilot.png">

This application utilizes the [signalk-autopilot](https://github.com/SignalK/signalk-autopilot) plugin and passes requests as PUT requests and subcribes to relevant topics to display data. 

One interesting extension to the autopilot would be to have small esp32 based wireless remote for your autopilot with physical buttons and a small display.

**WARNING** This application has not been tested with a real autopilot yet, only the simulated one provided by the autopilot plugin.

**TODO:**

- [ ] Test using real autpilots
- [ ] UI update
- [ ] Would be nice to show a small nautical chart and the current leg of the route your are following

### Switchboard

 <img width="200px" src="/docs/images/switchboard.png">

Use the switchboard application to turn on and off smart switches. The application currectly populates a list of switches but you need to adjust them to your needs of course. The switches can control home assistant switches, SignalK switches or switches on the esp32 itself such as relays. Currently the control logic is not included so you cant control any switches yet.

**TODO:**

- [ ] Add control logic for turning on and off various switches on different platforms


## 🚀 Getting Started

```bash
git clone https://github.com/batuakan/ESPHelm.git
cd ESPHelm
```

Adjust the project to your needs

```bash
esphome run MFD.yaml
```

Build and upload to your esp device.

## What is missing

