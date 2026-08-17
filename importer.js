(() => {
  const modal = document.querySelector('#mc-fast-importer');

  if (!modal) {
    console.error('Fast importer window not found.');
    return;
  }

  const css = document.createElement('style');
  css.id = 'mc-fast-importer-visibility-fix';

  css.textContent = `
    #mc-fast-importer .box {
      padding-top: 24px !important;
    }

    #mc-fast-importer button.go {
      display: block !important;
      width: 100% !important;
      min-height: 48px !important;
      margin: 14px 0 10px !important;
      padding: 12px 18px !important;

      background: #ffffff !important;
      color: #111111 !important;

      border: 2px solid #ffffff !important;
      border-radius: 9px !important;

      font-family: system-ui, sans-serif !important;
      font-size: 15px !important;
      font-weight: 700 !important;
      line-height: 1.2 !important;
      text-align: center !important;

      opacity: 1 !important;
      visibility: visible !important;
      cursor: pointer !important;
    }

    #mc-fast-importer button.go:hover {
      background: #dddddd !important;
    }

    #mc-fast-importer button.go:disabled {
      opacity: 0.55 !important;
      cursor: wait !important;
    }

    #mc-fast-importer button.close {
      display: grid !important;
      place-items: center !important;

      position: sticky !important;
      top: 0 !important;
      float: right !important;
      z-index: 10 !important;

      width: 40px !important;
      height: 40px !important;
      padding: 0 !important;

      background: #333333 !important;
      color: #ffffff !important;
      border: 1px solid #777777 !important;
      border-radius: 50% !important;

      font-size: 25px !important;
      opacity: 1 !important;
      visibility: visible !important;
    }

    #mc-fast-importer progress {
      display: block !important;
      width: 100% !important;
      height: 12px !important;
    }

    #mc-fast-importer .status {
      display: block !important;
      margin-top: 10px !important;
      color: #ffffff !important;
    }

    #mc-fast-importer .log {
      display: block !important;
      min-height: 50px !important;
      color: #cccccc !important;
    }
  `;

  document.getElementById(css.id)?.remove();
  document.head.appendChild(css);

  const button = modal.querySelector('button.go');

  if (button) {
    button.textContent = 'Find tracks and create playlist';
    button.scrollIntoView({
      behavior: 'smooth',
      block: 'center'
    });
  }

  console.log('Importer button styling repaired.');
})();