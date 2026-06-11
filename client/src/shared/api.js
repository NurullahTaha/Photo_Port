async function request(method, url, body) {
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url)
};

/** Upload files with progress callback, using XHR (fetch lacks upload progress). */
export function uploadPhotos(files, folderId, onProgress) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    if (folderId) form.append('folderId', folderId);
    for (const file of files) form.append('photos', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/photos');
    xhr.withCredentials = true;
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error((data && data.error) || `Upload failed (${xhr.status})`));
    });
    xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
    xhr.send(form);
  });
}
