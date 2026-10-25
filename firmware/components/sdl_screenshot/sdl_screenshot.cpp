#include "sdl_screenshot.h"
#include <ctime>
#include <cstdio>

namespace esphome
{
    namespace sdl_screenshot
    {

        std::string Screenshot::generate_filename()
        {
            std::time_t now = std::time(0);
            std::tm *t = std::localtime(&now);
            char buf[64];
            std::strftime(buf, sizeof(buf), "screenshot_%Y%m%d_%H%M%S.bmp", t);
            return std::string(buf);
        }

        void Screenshot::take_screenshot()
        {
            take_screenshot(generate_filename());
        }

        void Screenshot::take_screenshot(const std::string &filename)
        {
            const Uint32 format = SDL_PIXELFORMAT_ARGB8888;

            SDL_Window *window = SDL_GetWindowFromID(1);
            if (!window)
                return;

            SDL_Renderer *renderer = SDL_GetRenderer(window);
            if (!renderer)
                return;

            int width, height;
            SDL_GetRendererOutputSize(renderer, &width, &height);

            SDL_Surface *surface =
                SDL_CreateRGBSurfaceWithFormat(0, width, height, 32, format);

            SDL_RenderReadPixels(renderer, NULL, format, surface->pixels, surface->pitch);

            SDL_SaveBMP(surface, filename.c_str());
            SDL_FreeSurface(surface);

            ESP_LOGI("sdl", "Screenshot saved: %s", filename.c_str());
        }

    } // namespace sdl_screenshot
} // namespace esphome
