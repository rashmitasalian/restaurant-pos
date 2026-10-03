import React from "react";
import restoNitiMark from "../../assets/restoniti-icon.png";
import { Button } from "../../components/ui/Button";
import styles from "./Activation.module.css";

type UnlicensedStatus = {
  status: "unlicensed";
  message?: string;
  supportDetail?: string | null;
};

export default function Activation({
  initialStatus,
  onActivated,
}: {
  initialStatus: UnlicensedStatus;
  onActivated: () => void;
}) {
  const [code, setCode] = React.useState<string | null>(null);
  const [codeError, setCodeError] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState(
    initialStatus.message || "This computer is not activated for RestoNiti.",
  );
  const [supportDetail, setSupportDetail] = React.useState<string | null>(
    initialStatus.supportDetail ?? null,
  );
  const [copied, setCopied] = React.useState(false);
  const [importing, setImporting] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    window.pos?.license
      ?.getInstallationCode()
      .then((result) => {
        if (!alive) {
          return;
        }
        if (result.ok) {
          setCode(result.code);
          setCodeError(null);
        } else {
          setCode(null);
          setCodeError(result.message);
        }
      })
      .catch(() => {
        if (alive) {
          setCodeError("RestoNiti could not read this installation. Please contact RestoNiti support.");
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const copyCode = async () => {
    const result = await window.pos?.license?.copyInstallationCode();
    if (result?.ok) {
      setCopied(true);
    }
  };

  const importLicense = async () => {
    setImporting(true);
    setCopied(false);
    try {
      const result = await window.pos?.license?.importLicense();
      if (!result || result.cancelled) {
        return;
      }
      if (!result.ok) {
        setMessage(result.message || "This license could not be verified.");
        setSupportDetail(result.reason ?? null);
        return;
      }
      onActivated();
    } catch {
      setMessage(
        "RestoNiti could not finish activation. Restart the app. If it happens again, contact RestoNiti support.",
      );
      setSupportDetail("import-error");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className={styles.screen}>
      <section className={styles.card} aria-labelledby="activation-title">
        <img src={restoNitiMark} alt="" className={styles.mark} />
        <h1 id="activation-title" className={styles.title}>
          Activate this computer
        </h1>
        <p className={styles.message}>{message}</p>
        <label className={styles.label} htmlFor="installation-code">
          Installation Code
        </label>
        <textarea
          id="installation-code"
          className={styles.code}
          readOnly
          rows={4}
          value={code || codeError || ""}
          aria-readonly="true"
        />
        <div className={styles.actions}>
          <Button type="button" variant="secondary" onClick={copyCode} disabled={!code}>
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button type="button" variant="primary" onClick={importLicense} loading={importing}>
            Choose License File
          </Button>
        </div>
        {supportDetail ? <p className={styles.support}>Support code: {supportDetail}</p> : null}
        <p className={styles.help}>Need a license? Contact RestoNiti support.</p>
      </section>
    </div>
  );
}
