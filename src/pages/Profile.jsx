import { useNavigate } from "react-router-dom";
import Header from "../components/Header";
import { useSocialMeta } from "../hooks/useSocialMeta";
import { SOCIAL_META } from "./ProfileSchema";
import { ProfileHead } from "./ProfileHead";
import {
  ProfileCardSection,
  ProfileIntroSection,
  ProfileStorySection,
  ProfileLessonsSection,
  ProfileExperienceSection,
  ProfileSocialSection,
} from "./ProfileSections";
import "./Profile.css";

export default function Profile() {
  const navigate = useNavigate();

  useSocialMeta(SOCIAL_META);

  return (
    <>
      <ProfileHead />

      <Header />

      <div className="profile-container">
        <div className="profile-header">
          <h1>運営者プロフィール</h1>
          <p>龍神レーダーを作った人について</p>
        </div>

        <ProfileCardSection />
        <ProfileIntroSection />
        <ProfileStorySection />
        <ProfileLessonsSection />
        <ProfileExperienceSection />
        <ProfileSocialSection />

        {/* CTA */}
        <section className="profile-cta">
          <h2>龍神レーダーを試してみる</h2>
          <p>登録不要・完全無料でAI予想を確認できます</p>
          <button onClick={() => navigate("/")} className="cta-button">
            AI予想を見る
          </button>
        </section>
      </div>
    </>
  );
}
