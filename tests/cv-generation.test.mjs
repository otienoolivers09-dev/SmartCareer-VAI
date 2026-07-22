import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfessionalCvText, buildProfessionalCoverLetter } from '../server/ai-fallbacks.js';

test('buildProfessionalCvText creates a strong standard CV structure', () => {
  const text = buildProfessionalCvText({
    cvType: 'standard',
    fullName: 'Jane Doe',
    email: 'jane@example.com',
    phone: '0712345678',
    city: 'Nairobi',
    country: 'Kenya',
    summary: 'Results-driven professional with experience in operations and customer success.',
    skills: ['Operations', 'Customer Service', 'Excel'],
    experience: [{ title: 'Operations Coordinator', company: 'Acme Ltd', location: 'Nairobi', period: '2022 - Present', details: ['Improved workflow efficiency by 25%', 'Led onboarding for 30+ clients'] }],
    education: [{ school: 'University of Nairobi', degree: 'BSc Business Administration', period: '2018 - 2022' }],
    certifications: [{ name: 'Google Project Management', issuer: 'Google', year: '2023' }]
  });

  assert.match(text, /PROFESSIONAL SUMMARY/);
  assert.match(text, /CORE COMPETENCIES/);
  assert.match(text, /PROFESSIONAL EXPERIENCE/);
  assert.match(text, /EDUCATION/);
  assert.match(text, /REFERENCES AVAILABLE UPON REQUEST/);
});

test('buildProfessionalCoverLetter includes a company address block when supplied', () => {
  const text = buildProfessionalCoverLetter({
    fullName: 'Jane Doe',
    companyName: 'Acme Holdings',
    companyAddress: 'P.O. Box 12345, Nairobi, Kenya',
    jobTitle: 'Operations Coordinator',
    skills: ['operations', 'customer success', 'team collaboration'],
    summary: 'I am excited to bring my experience to your organization.'
  });

  assert.match(text, /Acme Holdings/);
  assert.match(text, /P.O. Box 12345/);
  assert.match(text, /Dear Hiring Manager/);
  assert.match(text, /Sincerely,/);
});
