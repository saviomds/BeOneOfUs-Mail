export async function apiRequest(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    console.error(`Could not connect to ${path}.`, error);
    throw new Error("Could not connect to the server. Check your connection and try again.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    console.error(`The server returned an invalid response for ${path}.`, error);
    throw new Error("The server returned an unreadable response. Please try again.");
  }

  if (!response.ok) {
    const error = new Error(payload.error || "The request could not be completed.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

export function redirectToLoginIfUnauthorized(error) {
  if (error.status === 401) {
    window.location.assign("/login");
    return true;
  }
  return false;
}
