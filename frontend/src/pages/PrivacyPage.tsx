export default function PrivacyPage() {
  return (
    <main className="page">
      <div className="container legal">
        <h1 className="page__heading">Privacy Policy</h1>
        <p className="page__sub">Effective July 13, 2026</p>

        <p>
          Eagle Lens ("Eagle Lens," "we," "us," or "our") operates the website
          located at eaglelens.org (the "Service"), which lets Boston College
          students look up course and professor information and submit
          reviews. This Privacy Policy explains what information we collect,
          how we use it, and the choices you have.
        </p>
        <p>
          By using the Service, you agree to the collection and use of
          information in accordance with this Privacy Policy. If you do not
          agree, please do not use the Service.
        </p>
        <p>
          <strong>
            Eagle Lens is an independent, student-run project and is not
            affiliated with, endorsed by, or officially connected to Boston
            College.
          </strong>
        </p>

        <h2>1. Information We Collect</h2>

        <h3>1.1 Account information</h3>
        <p>
          If you sign in to the Service, you do so using Google Sign-In,
          which is limited to accounts on the @bc.edu domain. When you sign
          in, we (through our authentication provider, Supabase) receive and
          store your name and email address as provided by Google, a unique
          account identifier, and timestamps of account creation and sign-in
          activity. We do not receive or store your Google password.
        </p>

        <h3>1.2 Content you submit</h3>
        <p>
          If you choose to submit a review, we collect the course and
          professor you are reviewing, whether you would recommend the
          course/professor, the text of your comment, and the date and time
          of submission.
        </p>
        <p>
          <strong>Reviews are displayed anonymously.</strong> We do not
          display your name, email, or other identifying information
          alongside your review. However, your review is internally linked to
          your account so that you can edit or delete it later, and so we can
          enforce one review per course/professor per account.
        </p>
        <p>
          Some course and professor rating data displayed on the Service is
          drawn from Boston College's own public course catalog and course
          evaluation data, aggregated at the course/professor level. That
          data is not information "about you" personally submitted through
          this Service.
        </p>

        <h3>1.3 Information collected automatically</h3>
        <p>
          Like most websites, we and our service providers may automatically
          collect certain technical information when you visit the Service,
          such as your IP address, browser and device type, pages visited,
          time spent on pages, and referring URLs. This is collected through
          Vercel Web Analytics, which is configured to avoid collecting
          information that directly identifies you.
        </p>

        <h3>1.4 Cookies and local storage</h3>
        <p>
          The Service uses browser local storage (not third-party advertising
          cookies) to keep you signed in between visits. You can clear this
          at any time through your browser settings, which will sign you out.
        </p>

        <h2>2. How We Use Information</h2>
        <p>We use the information we collect to:</p>
        <ul>
          <li>
            Create and maintain your account and verify eligibility (a valid
            @bc.edu email).
          </li>
          <li>Display course and professor information and aggregate ratings.</li>
          <li>
            Let you submit, view, edit, and delete your own reviews and saved
            courses.
          </li>
          <li>
            Maintain the security and integrity of the Service, including
            preventing abuse (e.g., duplicate or fraudulent reviews).
          </li>
          <li>Understand aggregate usage of the Service so we can improve it.</li>
          <li>
            Communicate with you about the Service, if necessary (e.g., a
            policy change or a report about your content).
          </li>
        </ul>
        <p>
          We do <strong>not</strong> sell your personal information, and we
          do not use your data for third-party advertising.
        </p>

        <h2>3. How We Share Information</h2>
        <p>We do not share your personal information with third parties except:</p>
        <ul>
          <li>
            <strong>Service providers</strong> who process data on our behalf
            to operate the Service, specifically Supabase (database hosting,
            authentication, and storage), Google (sign-in), and Vercel
            (application hosting and analytics).
          </li>
          <li>
            <strong>Legal reasons</strong>, if required to do so by law,
            subpoena, or other legal process, or if we believe in good faith
            that disclosure is necessary to protect our rights, your safety,
            or the safety of others, or to investigate fraud or abuse.
          </li>
          <li>
            <strong>With your consent</strong>, for any other purpose
            disclosed to you at the time of collection.
          </li>
          <li>
            <strong>Business transfers</strong>, if Eagle Lens is involved in
            a merger, acquisition, or sale of assets, in which case we will
            provide notice before your information becomes subject to a
            different privacy policy.
          </li>
        </ul>
        <p>
          Reviews and comments you submit are displayed anonymously to all
          visitors of the Service as part of its normal operation.
        </p>

        <h2>4. Data Retention</h2>
        <p>
          We retain your account information and content for as long as your
          account is active. If you delete your account (or ask us to), we
          will delete or anonymize your personal information within a
          reasonable time, except where we are required or permitted to
          retain it (for example, to resolve disputes, enforce our
          agreements, or comply with legal obligations). Reviews you submit
          may be retained in de-identified form even after account deletion,
          since they are not displayed with identifying information in the
          first place.
        </p>

        <h2>5. Your Rights and Choices</h2>
        <p>
          Depending on your location, you may have rights to access, correct,
          or delete your personal information, or to object to or restrict
          certain processing. To exercise any of these rights, contact us at{' '}
          <a href="mailto:tomasliivak@gmail.com">tomasliivak@gmail.com</a>. We
          will respond within a reasonable time. You can also sign out at any
          time, which ends your local session, and edit or delete your
          reviews through the Service where that functionality is available.
        </p>

        <h2>6. Data Security</h2>
        <p>
          We use reasonable technical and organizational measures to protect
          your information, including relying on Supabase's row-level
          security so that account data and private information (such as
          your saved courses) are only accessible to you. However, no method
          of transmission or storage is 100% secure, and we cannot guarantee
          absolute security.
        </p>

        <h2>7. Children's Privacy</h2>
        <p>
          The Service is intended for use by college students and is not
          directed at children under 13. We do not knowingly collect personal
          information from children under 13. If you believe a child under 13
          has provided us with personal information, please contact us so we
          can delete it.
        </p>

        <h2>8. International Users</h2>
        <p>
          The Service is intended for use by Boston College students located
          in the United States. If you access the Service from outside the
          United States, your information will be transferred to and
          processed in the United States, where data protection laws may
          differ from those in your jurisdiction.
        </p>

        <h2>9. Changes to This Policy</h2>
        <p>
          We may update this Privacy Policy from time to time. If we make
          material changes, we will update the effective date above and,
          where appropriate, provide additional notice on the Service. Your
          continued use of the Service after a change becomes effective
          constitutes acceptance of the revised policy.
        </p>

        <h2>10. Contact Us</h2>
        <p>
          If you have questions about this Privacy Policy or how we handle
          your information, contact us at{' '}
          <a href="mailto:tomasliivak@gmail.com">tomasliivak@gmail.com</a>.
        </p>
      </div>
    </main>
  )
}
