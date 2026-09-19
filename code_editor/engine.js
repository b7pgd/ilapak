/*
 * PS Web - Engine Loader & Bootstrapper (FINAL)
 */

"use strict";

(function () {
  // Global Shared Namespace
  window.PSWeb = window.PSWeb || {};
  window.PSWeb.layers = window.PSWeb.layers || [];

  // Register Engine Layer Helper
  window.PSWeb.registerLayer = function (name, layerObject) {
    window.PSWeb.layers.push({ name, ...layerObject });
  };

  // Determine relative base URL based on engine.js location
  function getEngineBaseUrl() {
    if (document.currentScript && document.currentScript.src) {
      const src = document.currentScript.src;
      return src.substring(0, src.lastIndexOf("/") + 1);
    }
    return "./";
  }

  const baseUrl = getEngineBaseUrl();
  const engines = [
    "engine1.js",
    "engine2.js",
    "engine3.js",
    "engine4.js"
  ];

  function loadScriptSequentially(index) {
    if (index >= engines.length) {
      // All engines loaded, initialize application
      if (typeof window.PSWeb.initialize === "function") {
        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", () => {
            window.PSWeb.initialize();
          });
        } else {
          window.PSWeb.initialize();
        }
      } else {
        showLoaderError("PSWeb.initialize function not found after loading layers.");
      }
      return;
    }

    const scriptName = engines[index];
    const scriptUrl = baseUrl + scriptName;
    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = false;

    script.onload = () => {
      loadScriptSequentially(index + 1);
    };

    script.onerror = () => {
      showLoaderError(`Failed to load engine layer: ${scriptName}`);
    };

    document.head.appendChild(script);
  }

  function showLoaderError(message) {
    const errorText = `PS Web Engine Loader Error\n==========================\n${message}`;
    console.error(errorText);

    const el = document.getElementById("output");
    if (el) {
      el.textContent = errorText;
      el.classList.add("error");
    } else {
      alert(errorText);
    }
  }

  // Start sequential loading
  loadScriptSequentially(0);
})();
