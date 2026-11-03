import {
  getAdminOverview,
  getManagedAccountProfile,
  getAndMarkUserNotifications,
  updateManagedAccountProfile,
  updateManagedAccountStatus,
  verifyAdminActionPassword,
} from "../services/admin.service.js";
import { AccountError } from "../services/errors.js";
import {
  getSmtpSettingsSummary,
  saveSmtpSettings,
  testSmtpSettings,
} from "../services/smtp-settings.service.js";
import {
  getSupabaseSettingsSummary,
  saveSupabaseSettings,
  testSupabaseConnection,
} from "../services/supabase-settings.service.js";

export async function adminOverview(_request, response) {
  try {
    response.json(await getAdminOverview());
  } catch (error) {
    sendAdminError(response, error, "The admin dashboard could not be loaded.");
  }
}

export async function managedAccountProfile(request, response) {
  try {
    response.json({ user: await getManagedAccountProfile(request.params.userId) });
  } catch (error) {
    sendAdminError(response, error, "The employee profile could not be loaded.");
  }
}

export async function editManagedAccountProfile(request, response) {
  try {
    const user = await updateManagedAccountProfile(
      request.user,
      request.params.userId,
      request.body ?? {},
    );
    response.json({ user });
  } catch (error) {
    sendAdminError(response, error, "The employee profile could not be updated.");
  }
}

export async function changeAccountStatus(request, response) {
  try {
    const user = await updateManagedAccountStatus(
      request.user,
      request.params.userId,
      {
        status: request.body?.status,
        password: request.body?.password,
        reason: request.body?.reason,
      },
    );
    response.json({ user });
  } catch (error) {
    sendAdminError(response, error, "The account status could not be updated.");
  }
}

export async function userNotifications(request, response) {
  try {
    response.json({ notifications: await getAndMarkUserNotifications(request.user.id) });
  } catch (error) {
    sendAdminError(response, error, "Notifications could not be loaded.");
  }
}

export async function smtpSettings(request, response) {
  try {
    response.json({ settings: await getSmtpSettingsSummary() });
  } catch (error) {
    sendAdminError(response, error, "SMTP settings could not be loaded.");
  }
}

export async function updateSmtpSettings(request, response) {
  try {
    const settings = await saveSmtpSettings(
      request.user,
      request.body ?? {},
      verifyAdminActionPassword,
    );
    response.json({ settings, message: "SMTP settings saved." });
  } catch (error) {
    sendAdminError(response, error, "SMTP settings could not be saved.");
  }
}

export async function sendSmtpTest(request, response) {
  try {
    await testSmtpSettings(
      request.user,
      request.body ?? {},
      verifyAdminActionPassword,
      request.app.locals.smtpTestEmail,
    );
    response.json({ message: `A test email was sent to ${request.user.email}.` });
  } catch (error) {
    sendAdminError(response, error, "The SMTP test email could not be sent.");
  }
}

export async function supabaseSettings(_request, response) {
  try {
    response.json({ settings: await getSupabaseSettingsSummary() });
  } catch (error) {
    sendAdminError(response, error, "Database settings could not be loaded.");
  }
}

export async function updateSupabaseSettings(request, response) {
  try {
    const settings = await saveSupabaseSettings(
      request.user,
      request.body ?? {},
      verifyAdminActionPassword,
    );
    response.json({
      settings,
      message: "Supabase settings saved for a future database upgrade. JSON remains active.",
    });
  } catch (error) {
    sendAdminError(response, error, "Database settings could not be saved.");
  }
}

export async function testSupabaseConnectionRoute(request, response) {
  try {
    await verifyAdminActionPassword(request.user.id, request.body?.passwordConfirmation);
    await testSupabaseConnection(request.body ?? {}, request.app.locals.supabaseConnectionTest);
    response.json({ message: "Supabase connection test succeeded. JSON remains the active database." });
  } catch (error) {
    sendAdminError(response, error, "The database connection test failed.");
  }
}

function sendAdminError(response, error, fallbackMessage) {
  if (error instanceof AccountError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  console.error(fallbackMessage, error);
  response.status(500).json({ error: fallbackMessage });
}
