import { login, registerUser, logout, onAuthStateChangedListener, getCurrentUser, getFirebaseToken } from './auth.js';
import { apiUrl, fetchWithAuth, loadAppConfig, loadPayPalSdk, showPaymentStatus, normalizePhoneNumber, updateTotalAmount, downloadTextAsPdf } from './api.js?v=3';

/* ========================================
   SMART CAREER VAI - ENHANCED SCRIPT v3
   Improved UX, Form Handling, and Features
   ======================================== */

const HISTORY_KEY = 'smartCareerHistory';
let latestCV = '';
let latestCoverLetter = '';
let latestCvId = null;
let hasPaid = false;
let isSignupMode = false;
let currentWizardStep = 1;
let pendingAuthAction = null; // 'upload' | 'build' | null - preserved across auth flow

const assistantResults = {
  currentTab: 'cv',
  cv: '',
  coverLetter: '',
  interviewTips: '',
  healthAnalysis: null,
  missingSkills: null,
  salaryEstimate: null,
  recruiterView: null,
  linkedInSummary: '',
  careerRoadmap: ''
};

// ========== TOAST NOTIFICATION SYSTEM ==========

function createToastContainer() {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

function showToast(message, type = 'info', duration = 3000) {
  const container = createToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  
  container.appendChild(toast);
  
  const removeToast = () => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  };
  
  if (duration > 0) {
    setTimeout(removeToast, duration);
  }
  
  return removeToast;
}

function showSuccessToast(message, duration = 3000) {
  showToast(message, 'success', duration);
}

function showErrorToast(message, duration = 3000) {
  showToast(message, 'error', duration);
}

function showInfoToast(message, duration = 3000) {
  showToast(message, 'info', duration);
}

// ========== FORM VALIDATION ==========

const validators = {
  email: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
  phone: (value) => /^07\d{8}$/.test(value) || value === '',
  url: (value) => {
    if (!value) return true;
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  },
  required: (value) => value && value.trim().length > 0,
  minLength: (value, min) => value.length >= min,
};

function validateField(field) {
  const value = field.value.trim();
  const type = field.type;
  const name = field.name || field.id;
  
  if (field.hasAttribute('required') && !value) {
    showFieldError(field, `${name} is required`);
    return false;
  }
  
  if (type === 'email' && value && !validators.email(value)) {
    showFieldError(field, 'Please enter a valid email address');
    return false;
  }
  
  if (type === 'tel' && value && !validators.phone(value)) {
    showFieldError(field, 'Phone should be format: 07XXXXXXXX');
    return false;
  }
  
  if (type === 'url' && value && !validators.url(value)) {
    showFieldError(field, 'Please enter a valid URL');
    return false;
  }
  
  clearFieldError(field);
  return true;
}

function showFieldError(field, message) {
  field.classList.add('error');
  let errorEl = field.nextElementSibling;
  if (!errorEl || !errorEl.classList.contains('field-error')) {
    errorEl = document.createElement('div');
    errorEl.className = 'field-error';
    field.parentNode.insertBefore(errorEl, field.nextSibling);
  }
  errorEl.textContent = message;
}

function clearFieldError(field) {
  field.classList.remove('error');
  const errorEl = field.nextElementSibling;
  if (errorEl && errorEl.classList.contains('field-error')) {
    errorEl.remove();
  }
}

// ========== FORM MESSAGE DISPLAY ==========

function showFormMessage(message, type = 'info') {
  const messageBox = document.getElementById('formMessage') || document.getElementById('wizardMessage');
  if (!messageBox) return;
  messageBox.textContent = message;
  messageBox.className = `form-message ${type}`;
  messageBox.style.display = message ? 'block' : 'none';
}

function showFormError(message) {
  showFormMessage(message, 'error');
  showErrorToast(message);
}

function showFormSuccess(message) {
  showFormMessage(message, 'success');
  showSuccessToast(message);
}

function clearFormMessage() {
  showFormMessage('', 'info');
}

// ========== HERO LANDING PAGE LOGIC ==========

function initHeroLogic() {
  const heroLoginBtn = document.getElementById('heroLoginBtn');
  const uploadCvHeroBtn = document.getElementById('uploadCvHeroBtn');
  const createCvHeroBtn = document.getElementById('createCvHeroBtn');
  
  if (heroLoginBtn) {
    heroLoginBtn.addEventListener('click', () => {
      const heroSection = document.getElementById('heroSection');
      const authSection = document.getElementById('authSection');
      if (heroSection) heroSection.classList.add('hidden');
      if (authSection) authSection.classList.remove('hidden');
    });
  }

  if (uploadCvHeroBtn) {
    uploadCvHeroBtn.addEventListener('click', () => {
      const user = getCurrentUser();
      if (!user) {
        showSignupForm('upload');
      } else {
        showUploadSection();
      }
    });
  }

  if (createCvHeroBtn) {
    createCvHeroBtn.addEventListener('click', () => {
      const user = getCurrentUser();
      if (!user) {
        showSignupForm('build');
      } else {
        showWizardSection();
      }
    });
  }
}

// ========== SIGNUP CHOICE MODAL ==========

function openSignupChoice() {
  const modal = document.getElementById('signupChoiceModal');
  if (modal) modal.classList.remove('hidden');
}

function closeSignupChoice() {
  const modal = document.getElementById('signupChoiceModal');
  if (modal) modal.classList.add('hidden');
}

function initSignupChoice() {
  const uploadOption = document.getElementById('signupUploadOption');
  const buildOption = document.getElementById('signupBuildOption');
  
  if (uploadOption) {
    uploadOption.addEventListener('click', () => {
      closeSignupChoice();
      showSignupForm('upload');
    });
  }
  
  if (buildOption) {
    buildOption.addEventListener('click', () => {
      closeSignupChoice();
      showSignupForm('build');
    });
  }
}

function showSignupForm(type) {
  isSignupMode = true;
  // remember where the user wanted to go so we can continue after auth
  pendingAuthAction = type || null;
  const authSection = document.getElementById('authSection');
  const heroSection = document.getElementById('heroSection');
  
  if (heroSection) heroSection.classList.add('hidden');
  if (authSection) authSection.classList.remove('hidden');
  
  const primaryBtn = document.getElementById('primaryAuthBtn');
  if (primaryBtn) primaryBtn.textContent = 'Create Account';
  
  const careerField = document.getElementById('careerField');
  if (careerField && type === 'build') {
    careerField.classList.remove('hidden');
    careerField.setAttribute('required', 'true');
  }
}

// ========== AUTHENTICATION ==========

async function handleAuthSubmit() {
  const emailInput = document.getElementById('authEmail');
  const passwordInput = document.getElementById('authPassword');
  
  if (!emailInput || !passwordInput) return;
  
  const email = emailInput.value.trim();
  const password = passwordInput.value.trim();
  
  // Validate fields
  if (!validateField(emailInput) || !validateField(passwordInput)) {
    return;
  }
  
  if (!email || !password) {
    showFormError('Please fill in all fields');
    return;
  }
  
  clearFormMessage();
  
  try {
    if (isSignupMode) {
      await registerUser(email, password);
      showFormSuccess('Account created successfully! You are now signed in.');
    } else {
      await login(email, password);
      showFormSuccess('Signed in successfully!');
    }
    emailInput.value = '';
    passwordInput.value = '';
    // After successful auth we rely on the auth state change listener to show the app.
    // But also handle any pending action immediately if available.
    if (pendingAuthAction) {
      if (pendingAuthAction === 'upload') {
        showUploadSection();
      } else if (pendingAuthAction === 'build') {
        showWizardSection();
      }
      pendingAuthAction = null;
      isSignupMode = false;
    }
  } catch (error) {
    console.error('Auth error:', error);
    const message = error.message || 'Authentication failed';
    showFormError(`Error: ${message}`);
  }
}

function toggleAuthMode() {
  const primaryBtn = document.getElementById('primaryAuthBtn');
  const toggleText = document.getElementById('authToggleText');
  const careerField = document.getElementById('careerField');
  
  isSignupMode = !isSignupMode;
  
  if (isSignupMode) {
    primaryBtn.textContent = 'Register';
    toggleText.innerHTML = 'Already have an account? <button type="button" class="link-btn">Login</button>';
    if (careerField) careerField.classList.remove('hidden');
  } else {
    primaryBtn.textContent = 'Login';
    toggleText.innerHTML = 'Don\'t have an account? <button type="button" class="link-btn">Sign up</button>';
    if (careerField) careerField.classList.add('hidden');
  }
}

async function handleLogout() {
  try {
    await logout();
    setAppVisibility(false);
    showSuccessToast('Signed out successfully');
  } catch (error) {
    console.error('Logout error:', error);
    showErrorToast('Logout failed');
  }
}

// ========== APP VISIBILITY ==========

function setAppVisibility(isSignedIn) {
  const heroSection = document.getElementById('heroSection');
  const authSection = document.getElementById('authSection');
  const appSection = document.getElementById('appSection');
  
  clearFormMessage();
  
  if (isSignedIn) {
    if (heroSection) heroSection.classList.add('hidden');
    if (authSection) authSection.classList.add('hidden');
    if (appSection) appSection.classList.remove('hidden');
    showAppPage('landingPage');
    
    const user = getCurrentUser();
    const email = user?.email || 'User';
    const userStatus = document.getElementById('userStatus');
    if (userStatus) {
      userStatus.textContent = `Signed in as ${email}`;
    }
  } else {
    if (authSection) authSection.classList.add('hidden');
    if (appSection) appSection.classList.add('hidden');
    if (heroSection) heroSection.classList.remove('hidden');
  }
}

// ========== WIZARD NAVIGATION ==========

function initWizardNavigation() {
  const wizardNextBtn = document.getElementById('wizardNextBtn');
  const wizardBackBtn = document.getElementById('wizardBackBtn');
  const wizardGenerateBtn = document.getElementById('wizardGenerateBtn');
  
  if (wizardNextBtn) {
    wizardNextBtn.addEventListener('click', () => nextWizardStep());
  }
  
  if (wizardBackBtn) {
    wizardBackBtn.addEventListener('click', () => previousWizardStep());
  }
  
  if (wizardGenerateBtn) {
    wizardGenerateBtn.addEventListener('click', () => generateCVFromWizard());
  }
}

function updateWizardProgress(step, totalSteps = 10) {
  const progressFill = document.getElementById('wizardProgressFill');
  const stepLabel = document.getElementById('wizardStepLabel');
  const percentage = (step / totalSteps) * 100;
  
  if (progressFill) {
    progressFill.style.width = `${percentage}%`;
  }
  if (stepLabel) {
    stepLabel.textContent = `Step ${step} of ${totalSteps}`;
  }
  
  const progressBar = document.querySelector('.progress-bar');
  if (progressBar) {
    progressBar.setAttribute('aria-valuenow', percentage);
  }
}

function showWizardStep(step) {
  const steps = document.querySelectorAll('.wizard-step');
  steps.forEach(s => s.classList.add('hidden'));
  
  const targetStep = document.querySelector(`.wizard-step[data-step="${step}"]`);
  if (targetStep) {
    targetStep.classList.remove('hidden');
  }
  
  const backBtn = document.getElementById('wizardBackBtn');
  const nextBtn = document.getElementById('wizardNextBtn');
  const generateBtn = document.getElementById('wizardGenerateBtn');
  
  if (backBtn) {
    backBtn.classList.toggle('hidden', step === 1);
  }
  
  if (step === 10) {
    if (nextBtn) nextBtn.classList.add('hidden');
    if (generateBtn) generateBtn.classList.remove('hidden');
  } else {
    if (nextBtn) nextBtn.classList.remove('hidden');
    if (generateBtn) generateBtn.classList.add('hidden');
  }
  
  updateWizardProgress(step);
}

function showAppPage(sectionId) {
  const sectionIds = ['landingPage', 'uploadSection', 'wizardSection', 'resultsSection'];
  sectionIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.toggle('hidden', id !== sectionId);
    }
  });
}

function showLandingPage() {
  const appSection = document.getElementById('appSection');
  if (appSection) appSection.classList.remove('hidden');
  currentWizardStep = 1;
  showWizardStep(currentWizardStep);
  showAppPage('landingPage');
}

function showUploadSection() {
  const appSection = document.getElementById('appSection');
  const authSection = document.getElementById('authSection');
  const heroSection = document.getElementById('heroSection');
  if (heroSection) heroSection.classList.add('hidden');
  if (appSection) appSection.classList.remove('hidden');
  if (authSection) authSection.classList.add('hidden');
  showAppPage('uploadSection');
}

function showWizardSection() {
  const appSection = document.getElementById('appSection');
  const authSection = document.getElementById('authSection');
  const heroSection = document.getElementById('heroSection');
  if (heroSection) heroSection.classList.add('hidden');
  if (appSection) appSection.classList.remove('hidden');
  if (authSection) authSection.classList.add('hidden');
  currentWizardStep = 1;
  showWizardStep(currentWizardStep);
  showAppPage('wizardSection');
}

function showResultsSection() {
  const appSection = document.getElementById('appSection');
  if (appSection) appSection.classList.remove('hidden');
  showAppPage('resultsSection');
  setActiveResultsTab('cv');
}

function collectWizardData() {
  const getValue = id => document.getElementById(id)?.value.trim() || '';
  const nodeListToArray = nodes => Array.from(nodes || []);

  const educationRows = nodeListToArray(document.querySelectorAll('#educationRows .entry-row'))
    .map(row => ({
      institution: row.querySelector('input[name="institution"]')?.value.trim() || '',
      course: row.querySelector('input[name="course"]')?.value.trim() || '',
      grade: row.querySelector('input[name="grade"]')?.value.trim() || '',
      startYear: row.querySelector('input[name="startYear"]')?.value.trim() || '',
      endYear: row.querySelector('input[name="endYear"]')?.value.trim() || ''
    }))
    .filter(item => item.institution || item.course || item.grade || item.startYear || item.endYear);

  const skills = nodeListToArray(document.querySelectorAll('.skills-checkbox:checked')).map(cb => cb.value);
  const customSkills = nodeListToArray(document.querySelectorAll('#customSkillsList .tag'))
    .map(tag => tag.textContent?.replace('✕', '').trim())
    .filter(Boolean);

  const experienceRows = nodeListToArray(document.querySelectorAll('#experienceRows .entry-row'))
    .map(row => ({
      title: row.querySelector('input[name="title"]')?.value.trim() || '',
      company: row.querySelector('input[name="company"]')?.value.trim() || '',
      period: row.querySelector('input[name="period"]')?.value.trim() || '',
      details: row.querySelector('textarea[name="details"]')?.value.trim() || ''
    }))
    .filter(item => item.title || item.company || item.period || item.details);

  const projectRows = nodeListToArray(document.querySelectorAll('#projectRows .entry-row'))
    .map(row => ({
      projectName: row.querySelector('input[name="projectName"]')?.value.trim() || '',
      projectDescription: row.querySelector('textarea[name="projectDescription"]')?.value.trim() || '',
      projectRole: row.querySelector('input[name="projectRole"]')?.value.trim() || '',
      projectAchievements: row.querySelector('textarea[name="projectAchievements"]')?.value.trim() || ''
    }))
    .filter(item => item.projectName || item.projectDescription || item.projectRole || item.projectAchievements);

  const certificationRows = nodeListToArray(document.querySelectorAll('#certificationRows .entry-row'))
    .map(row => ({
      certName: row.querySelector('input[name="certName"]')?.value.trim() || '',
      certInstitution: row.querySelector('input[name="certInstitution"]')?.value.trim() || '',
      certYear: row.querySelector('input[name="certYear"]')?.value.trim() || ''
    }))
    .filter(item => item.certName || item.certInstitution || item.certYear);

  const achievementRows = nodeListToArray(document.querySelectorAll('#achievementRows .entry-row'))
    .map(row => row.querySelector('textarea[name="achievementDescription"]')?.value.trim() || '')
    .filter(Boolean);

  const languageItems = nodeListToArray(document.querySelectorAll('#wizardSection .skill-checkbox input:checked'))
    .map(cb => cb.value);

  const experienceExists = document.querySelector('input[name="experienceExists"]:checked')?.value || 'no';

  return {
    fullName: getValue('fullName'),
    phone: getValue('phone'),
    email: getValue('email'),
    location: getValue('location'),
    linkedin: getValue('linkedin'),
    portfolio: getValue('portfolio'),
    careerGoal: getValue('careerGoal'),
    jobDescription: getValue('jobDescription'),
    summary: getValue('summary'),
    education: educationRows,
    skills: [...skills, ...customSkills],
    experienceExists,
    experience: experienceRows,
    graduateExperience: getValue('graduateExperienceText'),
    projects: projectRows,
    certifications: certificationRows,
    languages: languageItems,
    achievements: achievementRows
  };
}

function collectUploadData() {
  const uploadText = document.getElementById('uploadCvText')?.value.trim();
  const name = document.getElementById('uploadFullName')?.value.trim();
  const targetRole = document.getElementById('uploadJobTarget')?.value.trim();
  const jobDescription = document.getElementById('uploadJobDescription')?.value.trim();
  const skills = document.getElementById('uploadSkills')?.value.split(',').map(s => s.trim()).filter(Boolean) || [];

  return {
    existingCv: uploadText,
    fullName: name,
    targetRole,
    jobDescription,
    skills
  };
}

async function generateCVFromWizard() {
  const payload = collectWizardData();
  if (!payload.fullName || !payload.email || !payload.careerGoal) {
    showFormError('Please complete the required fields before generating your CV.');
    return;
  }

  showFormMessage('Generating CV from your answers...');
  try {
    const response = await fetchWithAuth('/generate-cv', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || 'CV generation failed');
    }

    latestCV = result.cv || '';
    setOutputText(latestCV);
    showFormSuccess('CV generated successfully.');
    showResultsSection();
  } catch (error) {
    console.error('Wizard CV generation error:', error);
    showFormError(error.message || 'Unable to generate CV from wizard.');
  }
}

async function processUploadedCv() {
  const payload = collectUploadData();
  if (!payload.existingCv) {
    showFormError('Please paste your CV text before analysis.');
    return;
  }

  showFormMessage('Analyzing your uploaded CV...');
  try {
    const response = await fetchWithAuth('/analyze-cv-health', {
      method: 'POST',
      body: JSON.stringify({ cv: payload.existingCv })
    });
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || 'CV analysis failed');
    }

    assistantResults.healthAnalysis = result.health;
    const healthFeedback = document.getElementById('healthFeedback');
    if (healthFeedback) {
      healthFeedback.textContent = JSON.stringify(result.health, null, 2);
    }

    showFormSuccess('CV analyzed successfully. Ready to improve.');
    revealPremiumFeatures();
    showResultsSection();
    setActiveResultsTab('health');
  } catch (error) {
    console.error('Upload CV analysis error:', error);
    showFormError(error.message || 'Unable to analyze uploaded CV.');
  }
}

async function handleExtractProfile() {
  const payload = collectUploadData();
  if (!payload.existingCv) {
    showFormError('Please paste your CV text to extract your profile.');
    return;
  }

  const uploadStatus = document.getElementById('uploadStatus');
  if (uploadStatus) uploadStatus.textContent = 'Extracting profile information...';

  try {
    const response = await fetchWithAuth('/extract-info', {
      method: 'POST',
      body: JSON.stringify({ rawText: payload.existingCv })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Profile extraction failed');
    }

    let parsed = null;
    try {
      parsed = typeof result.result === 'string' ? JSON.parse(result.result) : result.result;
    } catch (e) {
      parsed = { raw: result.result };
    }

    if (parsed.fullName) document.getElementById('uploadFullName').value = parsed.fullName;
    if (parsed.careerGoal) document.getElementById('uploadJobTarget').value = parsed.careerGoal;
    if (parsed.skills) document.getElementById('uploadSkills').value = Array.isArray(parsed.skills) ? parsed.skills.join(', ') : parsed.skills;
    if (parsed.jobDescription) document.getElementById('uploadJobDescription').value = parsed.jobDescription;

    const output = document.getElementById('packageOutput');
    if (output) {
      output.textContent = 'Profile extracted successfully:\n' + formatJsonOutput(parsed);
    }
    showSuccessToast('Profile extracted. Review the auto-filled fields.');
    if (uploadStatus) uploadStatus.textContent = 'Profile extraction complete.';
    revealPremiumFeatures();
    showResultsSection();
  } catch (error) {
    console.error('Extract profile error:', error);
    if (uploadStatus) uploadStatus.textContent = 'Profile extraction failed.';
    showFormError(error.message || 'Unable to extract profile information.');
  }
}

async function generateFromUpload() {
  const payload = collectUploadData();
  if (!payload.existingCv) {
    showFormError('Please paste your CV text before generating.');
    return;
  }

  showFormMessage('Generating improved CV from your uploaded content...');
  try {
    const response = await fetchWithAuth('/generate-cv', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Improved CV generation failed');
    }

    latestCV = result.cv || '';
    setOutputText(latestCV);
    showFormSuccess('Improved CV generated successfully.');
    showResultsSection();
  } catch (error) {
    console.error('Upload CV generation error:', error);
    showFormError(error.message || 'Unable to generate improved CV from upload.');
  }
}

function nextWizardStep() {
  if (currentWizardStep < 10) {
    currentWizardStep++;
    showWizardStep(currentWizardStep);
  }
}

function previousWizardStep() {
  if (currentWizardStep > 1) {
    currentWizardStep--;
    showWizardStep(currentWizardStep);
  }
}

// ========== DYNAMIC FORM ENTRIES ==========

function addEducationRow() {
  const educationRows = document.getElementById('educationRows');
  if (!educationRows) return;
  
  const newRow = document.createElement('div');
  newRow.className = 'entry-row';
  newRow.innerHTML = `
    <input type="text" name="institution" placeholder="Institution/University" aria-label="Institution">
    <input type="text" name="course" placeholder="Course/Program" aria-label="Course">
    <input type="text" name="grade" placeholder="Grade/GPA" aria-label="Grade">
    <input type="text" name="startYear" placeholder="Start year" aria-label="Start year">
    <input type="text" name="endYear" placeholder="Completion year" aria-label="End year">
    <button type="button" class="secondary-btn remove-btn" onclick="this.parentElement.remove()">Remove</button>
  `;
  
  educationRows.appendChild(newRow);
}

function addExperienceRow() {
  const experienceRows = document.getElementById('experienceRows');
  if (!experienceRows) return;
  
  const newRow = document.createElement('div');
  newRow.className = 'entry-row experience-entry';
  newRow.innerHTML = `
    <input type="text" name="title" placeholder="Job Title" aria-label="Job title">
    <input type="text" name="company" placeholder="Company/Organization" aria-label="Company">
    <input type="text" name="period" placeholder="Period (e.g., Jan 2020 - Dec 2021)" aria-label="Period">
    <textarea name="details" placeholder="Key responsibilities and achievements" aria-label="Job details"></textarea>
    <button type="button" class="secondary-btn remove-btn" onclick="this.parentElement.remove()">Remove</button>
  `;
  
  experienceRows.appendChild(newRow);
}

function addProjectRow() {
  const projectRows = document.getElementById('projectRows');
  if (!projectRows) return;
  
  const newRow = document.createElement('div');
  newRow.className = 'entry-row project-entry';
  newRow.innerHTML = `
    <input type="text" name="projectName" placeholder="Project Name" aria-label="Project name">
    <textarea name="projectDescription" placeholder="Brief description" aria-label="Project description"></textarea>
    <input type="text" name="projectRole" placeholder="Your Role" aria-label="Your role">
    <textarea name="projectAchievements" placeholder="Key achievements/outcomes" aria-label="Achievements"></textarea>
    <button type="button" class="secondary-btn remove-btn" onclick="this.parentElement.remove()">Remove</button>
  `;
  
  projectRows.appendChild(newRow);
}

function addCertificationRow() {
  const certRows = document.getElementById('certificationRows');
  if (!certRows) return;
  
  const newRow = document.createElement('div');
  newRow.className = 'entry-row cert-entry';
  newRow.innerHTML = `
    <input type="text" name="certName" placeholder="Certificate Name" aria-label="Certificate name">
    <input type="text" name="certInstitution" placeholder="Issuing Organization" aria-label="Issuing organization">
    <input type="text" name="certYear" placeholder="Year Obtained" aria-label="Year">
    <button type="button" class="secondary-btn remove-btn" onclick="this.parentElement.remove()">Remove</button>
  `;
  
  certRows.appendChild(newRow);
}

function addAchievementRow() {
  const achievementRows = document.getElementById('achievementRows');
  if (!achievementRows) return;
  
  const newRow = document.createElement('div');
  newRow.className = 'entry-row achievement-entry';
  newRow.innerHTML = `
    <textarea name="achievementDescription" placeholder="Award, recognition, or achievement" aria-label="Achievement"></textarea>
    <button type="button" class="secondary-btn remove-btn" onclick="this.parentElement.remove()">Remove</button>
  `;
  
  achievementRows.appendChild(newRow);
}

function addCustomSkill() {
  const customSkillInput = document.getElementById('customSkill');
  const customSkillsList = document.getElementById('customSkillsList');
  
  if (!customSkillInput || !customSkillsList) return;
  
  const skill = customSkillInput.value.trim();
  if (!skill) {
    showInfoToast('Please enter a skill');
    return;
  }
  
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.innerHTML = `
    ${escapeHtml(skill)}
    <button type="button" onclick="this.parentElement.remove()">✕</button>
  `;
  
  customSkillsList.appendChild(tag);
  customSkillInput.value = '';
  showSuccessToast('Skill added!');
}

function fillExample(fieldId, value) {
  const field = document.getElementById(fieldId);
  if (field) {
    field.value = value;
    field.focus();
  }
}

// ========== CONDITIONAL SECTIONS ==========

function initConditionalSections() {
  // Experience toggle
  const experienceRadios = document.querySelectorAll('input[name="experienceExists"]');
  experienceRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      const experienceDetails = document.getElementById('experienceDetails');
      const graduateSection = document.getElementById('graduateBoostSection');
      
      if (experienceDetails) {
        experienceDetails.classList.toggle('hidden', e.target.value === 'no');
        experienceDetails.classList.toggle('visible', e.target.value === 'yes');
      }
      if (graduateSection) {
        graduateSection.classList.toggle('hidden', e.target.value === 'yes');
        graduateSection.classList.toggle('visible', e.target.value === 'no');
      }
    });
  });
}

// ========== OUTPUT DISPLAY ==========

function setOutputText(text) {
  const output = document.getElementById('packageOutput');
  if (!output) return;
  output.textContent = text || 'Generated content appears here...';
}

async function copyOutput() {
  const output = document.getElementById('packageOutput');
  const text = output?.textContent?.trim();
  
  if (!text || text === 'Generated content appears here...') {
    showErrorToast('Generate content first before copying');
    return;
  }
  
  try {
    await navigator.clipboard.writeText(text);
    showSuccessToast('Output copied to clipboard!');
  } catch (error) {
    console.error('Clipboard copy failed:', error);
    showErrorToast('Unable to copy to clipboard');
  }
}

function clearOutput() {
  const output = document.getElementById('packageOutput');
  if (output) output.textContent = 'Generated content appears here...';
  latestCV = '';
  latestCoverLetter = '';
  assistantResults.cv = '';
  assistantResults.coverLetter = '';
  assistantResults.interviewTips = '';
  assistantResults.healthAnalysis = null;
  assistantResults.missingSkills = null;
  assistantResults.salaryEstimate = null;
  assistantResults.recruiterView = null;
  assistantResults.linkedInSummary = '';
  assistantResults.careerRoadmap = '';
  showFormSuccess('Output cleared');
}

function formatJsonOutput(data) {
  if (!data) return 'No data available';
  try {
    return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  } catch (err) {
    return String(data);
  }
}

function getResultsTextForTab(tab) {
  switch (tab) {
    case 'cv':
      return latestCV || 'No generated CV available yet.';
    case 'cover':
      return latestCoverLetter || 'No cover letter generated yet.';
    case 'interview':
      return assistantResults.interviewTips || 'No interview tips generated yet.';
    case 'health':
      return assistantResults.healthAnalysis
        ? formatJsonOutput(assistantResults.healthAnalysis)
        : 'Run CV analysis to see the health report.';
    case 'skills':
      return assistantResults.missingSkills
        ? formatJsonOutput(assistantResults.missingSkills)
        : 'Run skills gap analysis to identify missing skills.';
    case 'salary':
      return assistantResults.salaryEstimate
        ? formatJsonOutput(assistantResults.salaryEstimate)
        : 'Estimate salary to see expected pay range.';
    case 'recruiter':
      return assistantResults.recruiterView
        ? formatJsonOutput(assistantResults.recruiterView)
        : 'Generate recruiter feedback for your CV.';
    default:
      return 'Select a section to view the output.';
  }
}

function setActiveResultsTab(tab) {
  assistantResults.currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(button => {
    const isActive = button.dataset.tab === tab;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
  setOutputText(getResultsTextForTab(tab));
}

function revealPremiumFeatures() {
  ['healthDashboard', 'skillsFinder', 'salaryEstimator', 'recruiterView', 'linkedInOptimizer', 'careerRoadmap'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('hidden');
  });
}

async function handleGenerateSummary() {
  const data = collectWizardData();
  if (!data.careerGoal) {
    showFormError('Please enter your target role so we can generate a summary.');
    return;
  }

  showFormMessage('Generating your professional summary...');
  try {
    const response = await fetchWithAuth('/generate-summary', {
      method: 'POST',
      body: JSON.stringify({
        careerGoal: data.careerGoal,
        fullName: data.fullName,
        skills: data.skills,
        experience: data.experience,
        education: data.education,
        summary: data.summary
      })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Summary generation failed');
    }
    const summaryField = document.getElementById('summary');
    if (summaryField) summaryField.value = result.summary;
    showFormSuccess('Professional summary generated successfully.');
  } catch (error) {
    console.error('Summary generation failed:', error);
    showFormError(error.message || 'Unable to generate summary.');
  }
}

function getCoverLetterPayload() {
  const wizard = collectWizardData();
  const upload = collectUploadData();
  const payload = {
    fullName: wizard.fullName || upload.fullName || 'Candidate',
    jobTarget: wizard.careerGoal || upload.targetRole || 'Your target role',
    skills: wizard.skills.length ? wizard.skills : upload.skills,
    cv: latestCV || upload.existingCv || ''
  };
  return payload;
}

async function handleGenerateCoverLetter() {
  const payload = getCoverLetterPayload();
  if (!payload.jobTarget) {
    showErrorToast('Provide a target role or upload a CV first.');
    return;
  }

  showPaymentStatus('Generating your cover letter...');

  try {
    const response = await fetchWithAuth('/generate-cover-letter', {
      method: 'POST',
      body: JSON.stringify({
        fullName: payload.fullName,
        jobTarget: payload.jobTarget,
        skills: payload.skills.join(', ')
      })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Cover letter generation failed');
    }
    latestCoverLetter = result.coverLetter || '';
    assistantResults.coverLetter = latestCoverLetter;
    setActiveResultsTab('cover');
    showSuccessToast('Cover letter generated successfully.');
    revealPremiumFeatures();
  } catch (error) {
    console.error('Cover letter generation error:', error);
    showPaymentStatus(error.message || 'Cover letter generation failed', true);
  }
}

async function handleGenerateInterviewTips() {
  const payload = getCoverLetterPayload();
  if (!payload.jobTarget) {
    showErrorToast('Provide a target role before generating interview tips.');
    return;
  }

  showPaymentStatus('Generating interview preparation tips...');

  try {
    const response = await fetchWithAuth('/generate-interview-tips', {
      method: 'POST',
      body: JSON.stringify({
        jobTarget: payload.jobTarget,
        skills: payload.skills.join(', '),
        experience: payload.cv || 'No detailed experience provided'
      })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Interview tips generation failed');
    }
    assistantResults.interviewTips = result.interviewTips || '';
    setActiveResultsTab('interview');
    showSuccessToast('Interview preparation generated successfully.');
  } catch (error) {
    console.error('Interview preparation error:', error);
    showPaymentStatus(error.message || 'Interview tips generation failed', true);
  }
}

async function handleGenerateLinkedIn() {
  const payload = getCoverLetterPayload();
  if (!payload.jobTarget) {
    showErrorToast('Provide a target role first to optimize your LinkedIn summary.');
    return;
  }

  showPaymentStatus('Generating LinkedIn summary...');
  try {
    const response = await fetchWithAuth('/generate-linkedin-summary', {
      method: 'POST',
      body: JSON.stringify({
        fullName: payload.fullName,
        jobTarget: payload.jobTarget,
        skills: payload.skills.join(', '),
        summary: payload.cv
      })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'LinkedIn summary generation failed');
    }
    assistantResults.linkedInSummary = result.linkedInSummary || result.summary || '';
    const linkedInOutput = document.getElementById('linkedInOutput');
    if (linkedInOutput) linkedInOutput.textContent = assistantResults.linkedInSummary;
    showSuccessToast('LinkedIn summary generated successfully.');
    revealPremiumFeatures();
  } catch (error) {
    console.error('LinkedIn generation error:', error);
    showPaymentStatus(error.message || 'LinkedIn generation failed', true);
  }
}

async function handleGenerateRoadmap() {
  const payload = getCoverLetterPayload();
  if (!payload.jobTarget) {
    showErrorToast('Provide a target role first to generate your career roadmap.');
    return;
  }

  showPaymentStatus('Generating career roadmap...');
  try {
    const response = await fetchWithAuth('/generate-career-roadmap', {
      method: 'POST',
      body: JSON.stringify({
        careerGoal: payload.jobTarget,
        skills: payload.skills.join(', '),
        experience: payload.cv
      })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Career roadmap generation failed');
    }
    assistantResults.careerRoadmap = result.roadmap || result.plan || '';
    const roadmapOutput = document.getElementById('roadmapOutput');
    if (roadmapOutput) roadmapOutput.textContent = assistantResults.careerRoadmap;
    showSuccessToast('Career roadmap generated successfully.');
    revealPremiumFeatures();
  } catch (error) {
    console.error('Career roadmap error:', error);
    showPaymentStatus(error.message || 'Career roadmap generation failed', true);
  }
}

async function handleAnalyzeHealth() {
  const cvText = latestCV || collectUploadData().existingCv;
  if (!cvText) {
    showErrorToast('Please generate or paste your CV before running analysis.');
    return;
  }

  showPaymentStatus('Analyzing CV health...');
  try {
    const response = await fetchWithAuth('/analyze-cv-health', {
      method: 'POST',
      body: JSON.stringify({ cv: cvText })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'CV analysis failed');
    }
    assistantResults.healthAnalysis = result.health;
    document.getElementById('healthFeedback').textContent = JSON.stringify(result.health, null, 2);
    setActiveResultsTab('health');
    showSuccessToast('CV health analysis completed.');
  } catch (error) {
    console.error('CV health analysis error:', error);
    showPaymentStatus(error.message || 'CV analysis failed', true);
  }
}

async function handleFindSkills() {
  const cvText = latestCV || collectUploadData().existingCv;
  const jobRole = document.getElementById('targetJobRole')?.value.trim() || collectUploadData().targetRole;
  if (!cvText || !jobRole) {
    showErrorToast('Provide a CV and target role before running skills analysis.');
    return;
  }

  showPaymentStatus('Finding missing skills...');
  try {
    const response = await fetchWithAuth('/find-missing-skills', {
      method: 'POST',
      body: JSON.stringify({ cv: cvText, jobRole })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Skills analysis failed');
    }
    assistantResults.missingSkills = result.skills;
    document.getElementById('skillsComparison').textContent = JSON.stringify(result.skills, null, 2);
    setActiveResultsTab('skills');
    showSuccessToast('Skills gap analysis complete.');
  } catch (error) {
    console.error('Skills analysis error:', error);
    showPaymentStatus(error.message || 'Skills gap analysis failed', true);
  }
}

async function handleEstimateSalary() {
  const country = document.getElementById('salaryCountry')?.value;
  const industry = document.getElementById('salaryIndustry')?.value;
  const experience = document.getElementById('salaryExperience')?.value;

  if (!country || !industry || !experience) {
    showErrorToast('Select country, industry and experience level first.');
    return;
  }

  showPaymentStatus('Estimating salary...');
  try {
    const response = await fetchWithAuth('/estimate-salary', {
      method: 'POST',
      body: JSON.stringify({ country, industry, experience })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Salary estimation failed');
    }
    assistantResults.salaryEstimate = result.salary;
    document.getElementById('salaryResults').textContent = JSON.stringify(result.salary, null, 2);
    setActiveResultsTab('salary');
    showSuccessToast('Salary estimate created successfully.');
  } catch (error) {
    console.error('Salary estimation error:', error);
    showPaymentStatus(error.message || 'Salary estimate failed', true);
  }
}

async function handleRecruiterView() {
  const cvText = latestCV || collectUploadData().existingCv;
  const jobRole = document.getElementById('targetJobRole')?.value.trim() || collectUploadData().targetRole;
  if (!cvText) {
    showErrorToast('Please generate or paste your CV before requesting recruiter feedback.');
    return;
  }

  showPaymentStatus('Generating recruiter view...');
  try {
    const response = await fetchWithAuth('/recruiter-view', {
      method: 'POST',
      body: JSON.stringify({ cv: cvText, jobRole })
    });
    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || 'Recruiter view generation failed');
    }
    assistantResults.recruiterView = result.view;
    document.getElementById('recruiterViewContent').textContent = JSON.stringify(result.view, null, 2);
    setActiveResultsTab('recruiter');
    showSuccessToast('Recruiter view generated successfully.');
  } catch (error) {
    console.error('Recruiter view error:', error);
    showPaymentStatus(error.message || 'Recruiter view generation failed', true);
  }
}

async function analyzeJobDescription() {
  const textarea = document.getElementById('jobText');
  const resultPanel = document.getElementById('jobAnalysisResult');
  const rawPanel = document.getElementById('jobAnalysisRaw');
  const jobText = textarea?.value?.trim() || '';

  if (!jobText) {
    showFormError('Please paste a job advert or description first.');
    return;
  }

  showFormMessage('Analyzing job description...');
  try {
    const resp = await fetch(apiUrl('/analyze-job'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobText })
    });
    const data = await resp.json();
    if (!resp.ok || !data.success) {
      throw new Error(data.message || 'Job analysis failed');
    }

    clearFormMessage();
    if (data.parsed) {
      const p = data.parsed;
      resultPanel.classList.remove('hidden');
      rawPanel.classList.add('hidden');
      rawPanel.textContent = '';
      resultPanel.innerHTML = `
        <div class="analysis-report">
          <h3>Match Score: ${p.matchScore ?? 'N/A'}%</h3>
          <div class="analysis-section"><strong>Chance of Interview:</strong> ${p.chanceOfInterview || 'Medium'}</div>
          <div class="analysis-section"><strong>Strengths</strong>
            <ul class="analysis-list">${(p.strengths||[]).map(s=>`<li>${escapeHtml(s)}</li>`).join('')}</ul>
          </div>
          <div class="analysis-section"><strong>Weaknesses</strong>
            <ul class="analysis-list">${(p.weaknesses||[]).map(s=>`<li>${escapeHtml(s)}</li>`).join('')}</ul>
          </div>
          <div class="analysis-section"><strong>Suggested Improvements</strong>
            <ol class="analysis-list">${(p.suggestedImprovements||[]).map(s=>`<li>${escapeHtml(s)}</li>`).join('')}</ol>
          </div>
        </div>
      `;
    } else {
      // show raw model output
      resultPanel.classList.add('hidden');
      rawPanel.classList.remove('hidden');
      rawPanel.textContent = data.raw || 'No analysis available.';
    }

    showSuccessToast('Job analysis complete.');
  } catch (err) {
    console.error('Job analysis error:', err);
    showFormError(err.message || 'Job analysis failed');
  }
}

function handleFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const uploadText = document.getElementById('uploadCvText');
  const reader = new FileReader();
  const extension = file.name.split('.').pop().toLowerCase();

  reader.onload = async (e) => {
    const content = e.target.result;
    if (extension === 'pdf' || extension === 'docx' || extension === 'doc') {
      try {
        if (extension === 'pdf') {
          uploadText.value = 'PDF upload is currently not automatically extracted. Please paste the text manually.';
          showInfoToast('PDF upload selected. Paste text if extraction is not available.');
          return;
        }
        if (extension === 'docx' || extension === 'doc') {
          uploadText.value = 'Document upload is currently not automatically extracted. Please paste the text manually.';
          showInfoToast('Document upload selected. Paste text manually.');
          return;
        }
      } catch (err) {
        console.error('File parsing error:', err);
        showErrorToast('Unable to extract file text. Please paste the content manually.');
      }
    } else if (file.type.startsWith('image/')) {
      try {
        const result = await Tesseract.recognize(file, 'eng');
        uploadText.value = result.data.text || '';
        showSuccessToast('Image text extracted successfully.');
      } catch (err) {
        console.error('OCR error:', err);
        showErrorToast('Image OCR failed. Please paste your CV text manually.');
      }
    } else {
      uploadText.value = content || '';
    }
  };

  if (file.type.startsWith('image/') || file.name.toLowerCase().endsWith('.txt')) {
    reader.readAsText(file);
  } else if (file.name.toLowerCase().endsWith('.pdf') || file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.doc')) {
    reader.readAsArrayBuffer(file);
  } else {
    reader.readAsText(file);
  }
}

function handleStartOver() {
  latestCV = '';
  latestCoverLetter = '';
  assistantResults.cv = '';
  assistantResults.coverLetter = '';
  assistantResults.interviewTips = '';
  assistantResults.healthAnalysis = null;
  assistantResults.missingSkills = null;
  assistantResults.salaryEstimate = null;
  assistantResults.recruiterView = null;
  assistantResults.linkedInSummary = '';
  assistantResults.careerRoadmap = '';
  document.getElementById('uploadCvText').value = '';
  document.getElementById('uploadFullName').value = '';
  document.getElementById('uploadJobTarget').value = '';
  document.getElementById('uploadJobDescription').value = '';
  document.getElementById('uploadSkills').value = '';
  showLandingPage();
}

// ========== HISTORY ==========

function renderHistory() {
  const historyEl = document.getElementById('history');
  if (!historyEl) return;
  
  try {
    const rawData = localStorage.getItem(HISTORY_KEY);
    const histories = rawData ? JSON.parse(rawData) : [];
    
    if (!Array.isArray(histories)) throw new Error('Corrupted history data');
    
    historyEl.innerHTML = histories.length
      ? histories.map(entry => {
          try {
            const date = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : 'Unknown date';
            return `<div class="history-item"><strong>${escapeHtml(entry.title)}</strong><div>${escapeHtml(entry.details)}</div><small>${date}</small></div>`;
          } catch (e) {
            console.error('Error rendering history item:', e);
            return '';
          }
        }).join('')
      : '<p>No saved items yet.</p>';
  } catch (err) {
    console.error('History render error:', err);
    historyEl.innerHTML = '<p>Failed to load history.</p>';
  }
}

function saveHistory(title, details) {
  try {
    const rawData = localStorage.getItem(HISTORY_KEY) || '[]';
    const histories = JSON.parse(rawData);
    
    if (!Array.isArray(histories)) throw new Error('Corrupted history data');
    
    histories.unshift({
      title: String(title),
      details: String(details),
      createdAt: new Date().toISOString()
    });
    
    localStorage.setItem(HISTORY_KEY, JSON.stringify(histories.slice(0, 20)));
    renderHistory();
  } catch (err) {
    console.error('Failed to save history:', err);
  }
}

function saveDraft() {
  const draft = {
    cv: latestCV,
    coverLetter: latestCoverLetter,
    timestamp: new Date().toISOString()
  };
  
  try {
    localStorage.setItem('smartCareerDraft', JSON.stringify(draft));
    saveHistory('Draft saved', latestCV ? 'Saved your CV draft to the career dashboard.' : 'Saved your cover letter draft.');
    renderHistory();
    showSuccessToast('Draft saved successfully!');
  } catch (err) {
    console.error('Failed to save draft:', err);
    showErrorToast('Unable to save draft');
  }
}

function loadDraft() {
  try {
    const draft = localStorage.getItem('smartCareerDraft');
    if (draft) {
      const { cv, coverLetter } = JSON.parse(draft);
      if (cv) latestCV = cv;
      if (coverLetter) latestCoverLetter = coverLetter;
      showSuccessToast('Draft loaded!');
    }
  } catch (err) {
    console.error('Failed to load draft:', err);
  }
}

// ========== UTILITY FUNCTIONS ==========

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ========== PAYMENT ==========

function setupPaymentListeners() {
  const serviceChecks = document.querySelectorAll('.serviceCheck');
  const mpesaPhoneInput = document.getElementById('mpesaPhone');
  const payServiceBtn = document.getElementById('payServiceBtn');
  
  serviceChecks.forEach(check => {
    check.addEventListener('change', () => {
      let total = 0;
      serviceChecks.forEach(c => {
        if (c.checked) total += parseInt(c.value);
      });
      
      const totalAmount = document.getElementById('totalAmount');
      const payAmount = document.getElementById('payAmountM');
      if (totalAmount) totalAmount.textContent = total;
      if (payAmount) payAmount.textContent = total;
      
      // Enable/disable payment button
      if (payServiceBtn) {
        payServiceBtn.disabled = total === 0;
      }
    });
  });
}

async function payWithMpesa() {
  const mpesaPhone = document.getElementById('mpesaPhone');
  const total = document.getElementById('totalAmount');
  
  if (!mpesaPhone || !mpesaPhone.value) {
    showErrorToast('Please enter your M-Pesa phone number');
    return;
  }
  
  const phoneNumber = normalizePhoneNumber(mpesaPhone.value);
  const amount = parseInt(total.textContent);
  
  if (!amount || amount === 0) {
    showErrorToast('Please select a service');
    return;
  }
  
  showPaymentStatus('Initiating M-Pesa payment...');
  
  try {
    const response = await fetchWithAuth('/api/payment/mpesa', {
      method: 'POST',
      body: JSON.stringify({
        phone: phoneNumber,
        amount: amount,
        description: 'Smart Career VAI Services'
      })
    });
    
    if (response.ok) {
      showPaymentStatus('M-Pesa prompt sent to your phone', 'success');
      showSuccessToast('Check your phone for M-Pesa prompt');
      hasPaid = true;
    } else {
      showPaymentStatus('Payment initiation failed', 'error');
      showErrorToast('Unable to initiate payment');
    }
  } catch (error) {
    console.error('Payment error:', error);
    showPaymentStatus('Payment error occurred', 'error');
    showErrorToast('Payment failed');
  }
}

// ========== SHARE FUNCTIONALITY ==========

function shareOnTwitter() {
  const text = `Just created a professional CV with AI! 🚀 Check out @SmartCareerVAI - it helped me create an ATS-optimized CV and cover letter. Join 10K+ job seekers accelerating their careers! ${window.location.origin}`;
  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(window.location.origin)}`;
  window.open(url, '_blank', 'width=600,height=400');
  showSuccessToast('Opening Twitter share...');
}

function shareOnLinkedIn() {
  const text = `I just created my professional CV using AI with Smart Career VAI! The tool helped me:
- Generate an ATS-optimized CV
- Create a compelling cover letter  
- Get interview preparation tips

If you're job hunting, definitely check it out! ${window.location.origin}`;
  const url = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(window.location.origin)}`;
  window.open(url, '_blank', 'width=600,height=400');
  showSuccessToast('Opening LinkedIn share...');
}

function shareViaEmail() {
  const subject = `Check out Smart Career VAI - AI CV Generator`;
  const body = `Hey! I just used Smart Career VAI to create my professional CV, cover letter, and got interview tips. It's super easy and uses AI to optimize everything for employers. Check it out: ${window.location.origin}\n\nYou can even try their free ATS checker and CV health analyzer without signing up!`;
  const mailtoLink = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.open(mailtoLink);
  showSuccessToast('Opening email client...');
}

function copyShareLink() {
  const link = window.location.origin;
  navigator.clipboard.writeText(link).then(() => {
    showSuccessToast('Link copied! Share it with your friends.');
  }).catch(() => {
    showErrorToast('Failed to copy link');
  });
}

// ========== INITIALIZATION ==========

document.addEventListener('DOMContentLoaded', () => {
  // Initialize auth
  const primaryAuthBtn = document.getElementById('primaryAuthBtn');
  const authToggleText = document.getElementById('authToggleText');
  const logoutBtn = document.getElementById('logoutBtn');
  
  if (primaryAuthBtn) {
    primaryAuthBtn.addEventListener('click', handleAuthSubmit);
  }
  
  if (authToggleText) {
    authToggleText.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') {
        toggleAuthMode();
      }
    });
  }
  
  if (logoutBtn) {
    logoutBtn.addEventListener('click', handleLogout);
  }
  
  // Initialize wizard
  initWizardNavigation();
  initConditionalSections();
  
  // Initialize signup choice
  initSignupChoice();
  
  // Initialize form entries buttons
  const addEducationBtn = document.getElementById('addEducationRowBtn');
  const addExperienceBtn = document.getElementById('addExperienceRowBtn');
  const addProjectBtn = document.getElementById('addProjectRowBtn');
  const addCertBtn = document.getElementById('addCertificationRowBtn');
  const addAchievementBtn = document.getElementById('addAchievementRowBtn');
  const addCustomSkillBtn = document.getElementById('addCustomSkillBtn');
  
  if (addEducationBtn) addEducationBtn.addEventListener('click', addEducationRow);
  if (addExperienceBtn) addExperienceBtn.addEventListener('click', addExperienceRow);
  if (addProjectBtn) addProjectBtn.addEventListener('click', addProjectRow);
  if (addCertBtn) addCertBtn.addEventListener('click', addCertificationRow);
  if (addAchievementBtn) addAchievementBtn.addEventListener('click', addAchievementRow);
  if (addCustomSkillBtn) addCustomSkillBtn.addEventListener('click', addCustomSkill);
  
  // Initialize output buttons
  const copyOutputBtn = document.getElementById('copyOutputBtn');
  const clearOutputBtn = document.getElementById('clearOutputBtn');
  const saveDraftBtn = document.getElementById('saveDraftBtn');
  const processUploadedCvBtn = document.getElementById('processUploadedCvBtn');
  const generateFromUploadBtn = document.getElementById('generateFromUploadBtn');
  const downloadCvPdfBtn = document.getElementById('downloadCvPdfBtn');
  const downloadCoverLetterPdfBtn = document.getElementById('downloadCoverLetterPdfBtn');
  const generateSummaryBtn = document.getElementById('generateSummaryBtn');
  const generateCoverLetterBtn = document.getElementById('generateCoverLetterBtn');
  const generateInterviewTipsBtn = document.getElementById('generateInterviewTipsBtn');
  const generateLinkedInBtn = document.getElementById('generateLinkedInBtn');
  const generateRoadmapBtn = document.getElementById('generateRoadmapBtn');
  const analyzeHealthBtn = document.getElementById('analyzeHealthBtn');
  const findSkillsBtn = document.getElementById('findSkillsBtn');
  const estimateSalaryBtn = document.getElementById('estimateSalaryBtn');
  const generateRecruiterViewBtn = document.getElementById('generateRecruiterViewBtn');
  const cvFileInput = document.getElementById('uploadCvFile');
  const startOverBtn = document.getElementById('startOverBtn');
  
  if (copyOutputBtn) copyOutputBtn.addEventListener('click', copyOutput);
  if (clearOutputBtn) clearOutputBtn.addEventListener('click', clearOutput);
  if (saveDraftBtn) saveDraftBtn.addEventListener('click', saveDraft);
  if (processUploadedCvBtn) processUploadedCvBtn.addEventListener('click', processUploadedCv);
  const extractProfileBtn = document.getElementById('extractProfileBtn');
  if (extractProfileBtn) extractProfileBtn.addEventListener('click', handleExtractProfile);
  if (generateFromUploadBtn) generateFromUploadBtn.addEventListener('click', generateFromUpload);
  if (downloadCvPdfBtn) downloadCvPdfBtn.addEventListener('click', () => {
    if (!latestCV) {
      showErrorToast('Generate a CV before downloading.');
      return;
    }
    downloadTextAsPdf('SmartCareerCV.pdf', latestCV);
  });
  if (downloadCoverLetterPdfBtn) downloadCoverLetterPdfBtn.addEventListener('click', () => {
    if (!latestCoverLetter) {
      showErrorToast('Generate a cover letter before downloading.');
      return;
    }
    downloadTextAsPdf('SmartCareerCoverLetter.pdf', latestCoverLetter);
  });
  if (generateSummaryBtn) generateSummaryBtn.addEventListener('click', handleGenerateSummary);
  if (generateCoverLetterBtn) generateCoverLetterBtn.addEventListener('click', handleGenerateCoverLetter);
  if (generateInterviewTipsBtn) generateInterviewTipsBtn.addEventListener('click', handleGenerateInterviewTips);
  if (generateLinkedInBtn) generateLinkedInBtn.addEventListener('click', handleGenerateLinkedIn);
  if (generateRoadmapBtn) generateRoadmapBtn.addEventListener('click', handleGenerateRoadmap);
  if (analyzeHealthBtn) analyzeHealthBtn.addEventListener('click', handleAnalyzeHealth);
  if (findSkillsBtn) findSkillsBtn.addEventListener('click', handleFindSkills);
  if (estimateSalaryBtn) estimateSalaryBtn.addEventListener('click', handleEstimateSalary);
  if (generateRecruiterViewBtn) generateRecruiterViewBtn.addEventListener('click', handleRecruiterView);
  if (cvFileInput) cvFileInput.addEventListener('change', handleFileUpload);
  if (startOverBtn) startOverBtn.addEventListener('click', handleStartOver);
  const analyzeJobBtn = document.getElementById('analyzeJobBtn');
  if (analyzeJobBtn) analyzeJobBtn.addEventListener('click', analyzeJobDescription);

  document.querySelectorAll('.tab-btn').forEach(button => {
    button.addEventListener('click', () => {
      const tab = button.dataset.tab;
      if (tab) setActiveResultsTab(tab);
    });
  });
  
  // Initialize payment
  setupPaymentListeners();
  
  const payServiceBtn = document.getElementById('payServiceBtn');
  if (payServiceBtn) {
    payServiceBtn.addEventListener('click', payWithMpesa);
  }
  
  // Initialize app navigation buttons
  const uploadPathBtn = document.getElementById('uploadPathBtn');
  const wizardPathBtn = document.getElementById('wizardPathBtn');
  const backToLandingFromUpload = document.getElementById('backToLandingFromUpload');
  const backToLandingFromWizard = document.getElementById('backToLandingFromWizard');

  if (uploadPathBtn) uploadPathBtn.addEventListener('click', showUploadSection);
  if (wizardPathBtn) wizardPathBtn.addEventListener('click', showWizardSection);
  if (backToLandingFromUpload) backToLandingFromUpload.addEventListener('click', showLandingPage);
  if (backToLandingFromWizard) backToLandingFromWizard.addEventListener('click', showLandingPage);

  // Initialize hero
  initHeroLogic();
  
  // Initialize auth state listener
  onAuthStateChangedListener((user) => {
    setAppVisibility(!!user);
    // If user just signed in and had a pending action, continue
    if (user && pendingAuthAction) {
      if (pendingAuthAction === 'upload') showUploadSection();
      else if (pendingAuthAction === 'build') showWizardSection();
      pendingAuthAction = null;
      isSignupMode = false;
    }
  });
  
  // Initialize app config
  loadAppConfig();
  
  // Load saved draft if exists
  loadDraft();
});

// Global function exports for inline handlers
window.fillExample = fillExample;
window.closeSignupChoice = closeSignupChoice;
