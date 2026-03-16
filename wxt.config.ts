import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser, manifestVersion, mode, command }) => {
    return {
      manifest_version: 3,
      name: "PROJECT 2",
      description: "WXT DESCRIPTION",
      version: "1.0.0",
      permissions: ['activeTab', 'scripting', 'storage', 'cookies', 'sidePanel'],
      host_permissions: [
        "https://www.amazon.com/*",
        'https://*.lazada.com.ph/*',
        'https://*.lazada.com/*',
        'https://my.lazada.com.ph/*',
        'https://*.shopee.ph/*',
        'https://shopee.ph/*',
      ],
      icons: {
        16: "icon/16.png",
        24: "icon/24.png",
        32: "icon/32.png",
        64: "icon/64.png",
        128: "icon/128.png",
      },
      action: {
        default_icon: {
          24: "icon/24.png",
          32: "icon/32.png",
        },
      },
      side_panel: {
        default_path: 'popup.html',
      },
    };
  },
});
